#!/usr/bin/env python3
"""Build bounded sleep entry/exit clips and local idle blink frames."""

from __future__ import annotations

import argparse
from collections import deque
import hashlib
import importlib.util
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


def load_fringe_module():
    spec = importlib.util.spec_from_file_location("repair_fringe", Path(__file__).parent / "repair-pink-fringe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SIZE = 208
VIEWPORT = 200
MAX_SOURCE_BYTES = 30 * 1024 * 1024
MAX_SOURCE_PIXELS = 16_000_000
TRANSITION_COLUMNS = 4
TRANSITION_ROWS = 2
TRANSITION_FRAMES = 8
BLINK_COLUMNS = 3
BLINK_ROWS = 1
BLINK_FRAMES = 3
BLINK_FRAME_INDICES = (8, 9, 10)
BLINK_EYE_REGIONS = (
    ((93, 50), (121, 49), (123, 81), (94, 84)),
    ((117, 49), (149, 50), (150, 84), (120, 81)),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def open_source(path: Path) -> Image.Image:
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError(f"source exceeds byte budget: {path.name}")
    with Image.open(path) as opened:
        if opened.width * opened.height > MAX_SOURCE_PIXELS:
            raise ValueError(f"source exceeds pixel budget: {path.name}")
        if "A" not in opened.getbands():
            raise ValueError(f"source must contain alpha: {path.name}")
        return opened.convert("RGBA")


def split_grid(source: Image.Image, columns: int, rows: int, count: int) -> list[Image.Image]:
    cell_width = source.width / columns
    cell_height = source.height / rows
    if abs(cell_width - cell_height) > 1:
        raise ValueError("source must use square grid slots")
    frames = []
    for index in range(count):
        left = round(index % columns * cell_width)
        top = round(index // columns * cell_height)
        right = round((index % columns + 1) * cell_width)
        bottom = round((index // columns + 1) * cell_height)
        frame = source.crop((left, top, right, bottom))
        if frame.getchannel("A").point(lambda value: 255 if value > 16 else 0).getbbox() is None:
            raise ValueError(f"source frame {index} is empty")
        frames.append(frame)
    return frames


def keep_main_component(source: Image.Image) -> Image.Image:
    """Drop detached generated fragments while preserving the cat's soft alpha fringe."""
    alpha = source.getchannel("A")
    width, height = source.size
    opaque = bytearray(1 if value > 16 else 0 for value in alpha.tobytes())
    visited = bytearray(width * height)
    largest: list[int] = []
    for start, present in enumerate(opaque):
        if not present or visited[start]:
            continue
        visited[start] = 1
        queue = deque([start])
        component: list[int] = []
        while queue:
            offset = queue.popleft()
            component.append(offset)
            x, y = offset % width, offset // width
            for neighbor in (offset - 1, offset + 1, offset - width, offset + width):
                if neighbor < 0 or neighbor >= width * height or visited[neighbor] or not opaque[neighbor]:
                    continue
                neighbor_x = neighbor % width
                if abs(neighbor_x - x) > 1:
                    continue
                visited[neighbor] = 1
                queue.append(neighbor)
        if len(component) > len(largest):
            largest = component
    if not largest:
        raise ValueError("source frame has no main component")
    mask = Image.new("L", source.size)
    mask_data = bytearray(width * height)
    for offset in largest:
        mask_data[offset] = 255
    mask.frombytes(bytes(mask_data))
    mask = mask.filter(ImageFilter.MaxFilter(9))
    return Image.composite(source, Image.new("RGBA", source.size), mask)


def normalized_cell(source: Image.Image, density: int) -> Image.Image:
    viewport = VIEWPORT * density
    resized = source.convert("RGBa").resize(
        (viewport, viewport), Image.Resampling.LANCZOS,
    ).convert("RGBA")
    cell = Image.new("RGBA", (SIZE * density, SIZE * density))
    cell.alpha_composite(resized, ((SIZE * density - viewport) // 2,) * 2)
    box = cell.getchannel("A").point(lambda value: 255 if value > 16 else 0).getbbox()
    if box is None:
        raise ValueError("normalized frame is empty")
    margins = (box[0], box[1], SIZE * density - box[2], SIZE * density - box[3])
    if min(margins) < 3 * density:
        raise ValueError(f"normalized frame lacks safe padding: {margins}")
    return cell


def visible_bbox(source: Image.Image) -> tuple[int, int, int, int]:
    box = source.getchannel("A").point(lambda value: 255 if value > 16 else 0).getbbox()
    if box is None:
        raise ValueError("frame is empty")
    return box


def fit_to_box(source: Image.Image, target: tuple[int, int, int, int]) -> Image.Image:
    crop = source.crop(visible_bbox(source)).convert("RGBa").resize(
        (target[2] - target[0], target[3] - target[1]), Image.Resampling.LANCZOS,
    ).convert("RGBA")
    cell = Image.new("RGBA", source.size)
    cell.alpha_composite(crop, target[:2])
    return cell


def align_between_endpoints(
    cells: list[Image.Image], start: Image.Image, end: Image.Image,
) -> list[Image.Image]:
    """Make scale, center, and baseline change monotonically between exact endpoints."""
    start_box, end_box = visible_bbox(start), visible_bbox(end)
    denominator = len(cells) - 1
    aligned = []
    for index, cell in enumerate(cells):
        progress = index / denominator
        target = tuple(round(a + (b - a) * progress) for a, b in zip(start_box, end_box))
        aligned.append(fit_to_box(cell, target))
    aligned[0], aligned[-1] = start.copy(), end.copy()
    return aligned


def atlas_cells(atlas: Image.Image, columns: int, count: int, density: int) -> list[Image.Image]:
    cell = SIZE * density
    return [atlas.crop((index % columns * cell, index // columns * cell,
                        (index % columns + 1) * cell, (index // columns + 1) * cell))
            for index in range(count)]


def load_runtime_cell(path: Path, index: int, columns: int, density: int) -> Image.Image:
    with Image.open(path) as opened:
        image = opened.convert("RGBA")
    return atlas_cells(image, columns, index + 1, density)[index]


def write_atlas(cells: list[Image.Image], columns: int, rows: int, path: Path, density: int) -> None:
    atlas = Image.new("RGBA", (columns * SIZE * density, rows * SIZE * density))
    for index, cell in enumerate(cells):
        atlas.alpha_composite(cell, (index % columns * SIZE * density,
                                     index // columns * SIZE * density))
    atlas.save(path, lossless=True, exact=True)


def transition_cells(source: Image.Image, density: int) -> list[Image.Image]:
    return [normalized_cell(keep_main_component(frame), density) for frame in split_grid(
        source, TRANSITION_COLUMNS, TRANSITION_ROWS, TRANSITION_FRAMES,
    )]


def blink_cells(source: Image.Image, idle_atlas: Image.Image, density: int) -> list[Image.Image]:
    generated = [normalized_cell(frame, density) for frame in split_grid(
        source, BLINK_COLUMNS, BLINK_ROWS, BLINK_FRAMES,
    )]
    existing = atlas_cells(idle_atlas, 4, 12, density)
    generated = [fit_to_box(frame, visible_bbox(existing[0])) for frame in generated]
    mask = Image.new("L", existing[0].size)
    draw = ImageDraw.Draw(mask)
    for region in BLINK_EYE_REGIONS:
        draw.polygon([(x * density, y * density) for x, y in region], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.0 * density))
    for generated_cell, frame_index in zip(generated, BLINK_FRAME_INDICES):
        base = existing[0].copy()
        result = Image.composite(
            generated_cell.convert("RGBa"),
            base.convert("RGBa"),
            mask,
        ).convert("RGBA")
        result.paste(base, (0, 0), mask.point(lambda value: 255 if value == 0 else 0))
        existing[frame_index] = result
    return existing


def contact_sheet(groups: list[tuple[str, list[Image.Image]]], path: Path) -> None:
    width = max(len(cells) for _, cells in groups) * SIZE
    row_height = SIZE + 22
    sheet = Image.new("RGB", (width, len(groups) * 2 * row_height), "#202124")
    draw = ImageDraw.Draw(sheet)
    for group_index, (name, cells) in enumerate(groups):
        for background_index, color in enumerate(("#202124", "#f0f0f0")):
            y = (group_index * 2 + background_index) * row_height
            draw.rectangle((0, y, width, y + row_height), fill=color)
            for index, cell in enumerate(cells):
                panel = Image.new("RGBA", (SIZE, SIZE), color)
                panel.alpha_composite(cell)
                sheet.paste(panel.convert("RGB"), (index * SIZE, y))
                draw.text((index * SIZE + 6, y + SIZE + 3), f"{name} {index}",
                          fill="white" if background_index == 0 else "black")
    sheet.save(path)


def write_gif(cells: list[Image.Image], path: Path, durations: list[int]) -> None:
    frames = []
    for cell in cells:
        panel = Image.new("RGBA", (SIZE, SIZE), "#202124")
        panel.alpha_composite(cell)
        frames.append(panel.convert("RGB"))
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, disposal=2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enter-source", type=Path, required=True)
    parser.add_argument("--exit-source", type=Path, required=True)
    parser.add_argument("--blink-source", type=Path, required=True)
    parser.add_argument("--motion-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--qa-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.qa_dir.mkdir(parents=True, exist_ok=True)

    enter_source = open_source(args.enter_source)
    exit_source = open_source(args.exit_source)
    blink_source = open_source(args.blink_source)
    reports: dict[str, object] = {}
    preview_groups: list[tuple[str, list[Image.Image]]] = []

    for density, suffix in ((1, ""), (2, "@2x")):
        idle_path = args.motion_dir / f"idle{suffix}.webp"
        sleep_path = args.motion_dir / f"sleep{suffix}.webp"
        with Image.open(idle_path) as opened:
            idle_atlas = opened.convert("RGBA")
        idle_rest = atlas_cells(idle_atlas, 4, 1, density)[0]
        sleep_rest = load_runtime_cell(sleep_path, 0, 4, density)

        enter = align_between_endpoints(
            transition_cells(enter_source, density), idle_rest, sleep_rest,
        )
        exit_cells = align_between_endpoints(
            transition_cells(exit_source, density), sleep_rest, idle_rest,
        )
        # Clean pink fringe on intermediate transition frames
        fringe = load_fringe_module()
        for i in range(1, len(enter) - 1):
            enter[i], _ = fringe.repair_cell(enter[i], 5 * density)
        for i in range(1, len(exit_cells) - 1):
            exit_cells[i], _ = fringe.repair_cell(exit_cells[i], 5 * density)

        blink = blink_cells(blink_source, idle_atlas, density)

        outputs = {
            "sleep-enter": (enter, TRANSITION_COLUMNS, TRANSITION_ROWS),
            "sleep-exit": (exit_cells, TRANSITION_COLUMNS, TRANSITION_ROWS),
            "idle": (blink, 4, 3),
        }
        for name, (cells, columns, rows) in outputs.items():
            output = args.output_dir / f"{name}{suffix}.webp"
            write_atlas(cells, columns, rows, output, density)
            reports[f"{name}{suffix or '@1x'}"] = {
                "size": [columns * SIZE * density, rows * SIZE * density],
                "sha256": sha256(output),
                "frame_bboxes": [cell.getbbox() for cell in cells],
            }
        if density == 1:
            preview_groups = [
                ("enter", enter),
                ("exit", exit_cells),
                ("blink", blink[7:12]),
            ]
            write_gif(enter, args.qa_dir / "sleep-enter.gif", [180, 180, 200, 220, 220, 240, 260, 300])
            write_gif(exit_cells, args.qa_dir / "sleep-exit.gif", [220, 200, 200, 220, 220, 240, 260, 300])
            write_gif(blink[7:12], args.qa_dir / "idle-blink.gif", [700, 180, 260, 180, 700])

    contact_sheet(preview_groups, args.qa_dir / "sleep-transitions-contact.png")
    report = {
        "ok": True,
        "sources": {
            "enter": {"sha256": sha256(args.enter_source), "size": enter_source.size},
            "exit": {"sha256": sha256(args.exit_source), "size": exit_source.size},
            "blink": {"sha256": sha256(args.blink_source), "size": blink_source.size},
        },
        "outputs": reports,
        "invariants": {
            "transition_endpoints": "exact runtime idle/sleep cells",
            "transition_geometry": "visible bounds interpolate monotonically between endpoints",
            "blink_scope": "generated pixels limited to the declared eye-region mask",
            "stage_size": SIZE,
            "densities": [1, 2],
        },
    }
    (args.qa_dir / "sleep-transitions-build.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps({"ok": True, "outputs": len(reports)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
