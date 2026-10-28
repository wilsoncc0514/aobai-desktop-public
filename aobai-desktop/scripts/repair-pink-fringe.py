#!/usr/bin/env python3
"""User-authorized correction of magenta/brown matte missed by chroma QA.

Build-time only: Pillow and NumPy from the existing artifact runtime. Changes
only pink RGB connected to the five-logical-pixel edge, never alpha/geometry.
Original cleaned inputs remain available for rollback and reproducible builds.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def pink_mask(rgba: np.ndarray) -> np.ndarray:
    rgb = rgba[:, :, :3].astype(np.int16)
    red_excess = rgb[:, :, 0] - rgb[:, :, 1]
    warm_fur = np.maximum(rgb[:, :, 1] - rgb[:, :, 2], 0)
    # Brown-mixed magenta can become salmon (B <= G), not just purple.
    # Ordinary brown/tan has a corresponding G-B slope; matte red does not.
    return ((red_excess > 1.3 * warm_fur + 8)
            & (rgba[:, :, 3] > 0))


def repair_cell(cell: Image.Image, radius: int) -> tuple[Image.Image, dict]:
    if radius < 1:
        raise ValueError("radius must be positive")
    source = np.asarray(cell.convert("RGBA"))
    transparent = Image.fromarray(np.where(source[:, :, 3] == 0, 255, 0).astype(np.uint8))
    boundary = np.asarray(transparent.filter(ImageFilter.MaxFilter(radius * 2 + 1))) > 0
    pink = pink_mask(source)
    target = pink & boundary
    # Follow matte into narrow occlusion seams, but leave detached interior
    # pink features (nose/inner ears) alone. This is connectivity, not a larger
    # whole-body color threshold or global desaturation.
    while target.any():
        expanded = np.asarray(Image.fromarray(target.astype(np.uint8) * 255)
                              .filter(ImageFilter.MaxFilter(3))) > 0
        connected = pink & expanded
        if np.array_equal(connected, target):
            break
        target = connected
    output = source.copy()
    if not target.any():
        return Image.fromarray(output), {"changed": 0, "remaining_edge_pink": 0}

    # Do not let deeper pink (including natural nose color) supply edge RGB.
    # Warm/neutral fur only: mixing red and blue non-pink donors can otherwise
    # recreate magenta. B <= G remains true under linear-light averaging.
    donor_rgb = source[:, :, :3].astype(np.int16)
    donor_warmth = donor_rgb[:, :, 1] - donor_rgb[:, :, 2]
    donor_red = donor_rgb[:, :, 0] - donor_rgb[:, :, 1]
    filled = ((source[:, :, 3] >= 240) & ~pink & ~boundary
              & (donor_warmth >= 0) & (donor_red <= donor_warmth + 2))
    rgb = source[:, :, :3].astype(np.float64) / 255
    colors = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    height, width = filled.shape
    # Thin fur tips can be farther from the opaque interior than the band width.
    # Bound propagation to 40 logical pixels (thin extended legs/whiskers);
    # never borrow across frame cells. Record the longest donor reach for QA.
    reach = 0
    for _ in range(radius * 8 + 1):
        if np.all(filled[target]):
            break
        weights = np.zeros((height, width), dtype=np.uint8)
        total = np.zeros_like(colors)
        padded_mask = np.pad(filled, 1)
        padded_colors = np.pad(colors * filled[:, :, None], ((1, 1), (1, 1), (0, 0)))
        for dy in range(3):
            for dx in range(3):
                if (dy, dx) == (1, 1):
                    continue
                weights += padded_mask[dy:dy + height, dx:dx + width]
                total += padded_colors[dy:dy + height, dx:dx + width]
        update = ~filled & (weights > 0)
        if not update.any():
            break
        colors[update] = total[update] / weights[update, None]
        filled[update] = True
        reach += 1
    if not np.all(filled[target]):
        raise ValueError("edge has no nearby clean fur donor; manual review required")
    cleaned = np.where(colors <= 0.0031308, colors * 12.92, 1.055 * colors ** (1 / 2.4) - 0.055)
    output[target, :3] = np.clip(np.rint(cleaned[target] * 255), 0, 255).astype(np.uint8)
    remaining = int((pink_mask(output) & boundary).sum())
    if remaining:
        raise ValueError(f"{remaining} pink edge pixels remain after repair")
    return Image.fromarray(output), {"changed": int(target.sum()), "remaining_edge_pink": remaining,
                                    "maximum_donor_reach_pixels": reach}


def repair_atlas(atlas: Image.Image, scale: int) -> tuple[Image.Image, dict]:
    if scale not in (1, 2) or atlas.size != (1536 * scale, 2288 * scale):
        raise ValueError("expected standard v2 or desktop 2x atlas")
    source = atlas.convert("RGBA")
    output = source.copy()
    cells = {}
    for row in range(11):
        for column in range(8):
            box = (column * 192 * scale, row * 208 * scale,
                   (column + 1) * 192 * scale, (row + 1) * 208 * scale)
            try:
                repaired, report = repair_cell(source.crop(box), 5 * scale)
            except ValueError as error:
                raise ValueError(f"r{row}c{column}: {error}") from error
            output.paste(repaired, box[:2])
            cells[f"r{row}c{column}"] = report
    alpha_preserved = output.getchannel("A").tobytes() == source.getchannel("A").tobytes()
    if not alpha_preserved:
        raise AssertionError("repair modified alpha")
    return output, {"ok": True, "algorithm": "edge-local-clean-fur-rgb-propagation",
                    "user_override": "2026-09-02: 不接受当前这条边; continue deterministic repair",
                    "logical_edge_radius": 5, "include_connected_matte_seams": True,
                    "scale": scale, "alpha_preserved": alpha_preserved,
                    "changed_pixels": sum(c["changed"] for c in cells.values()), "cells": cells}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--scale", type=int, choices=(1, 2), required=True)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error("output must not overwrite the baseline input")
    with Image.open(args.input) as source:
        output, report = repair_atlas(source, args.scale)
    if args.output.suffix.lower() == ".webp":
        output.save(args.output, lossless=True, exact=True)
    elif args.output.suffix.lower() == ".png":
        output.save(args.output)
    else:
        parser.error("output must be lossless WebP or PNG")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "cells"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
