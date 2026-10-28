"""Check shipped motion atlases, including transparent padding at both densities."""
import json
import os
from pathlib import Path
import unittest

from PIL import Image
import numpy as np

MOTION_ROOT = Path(os.environ.get("AOBAI_TEST_MOTION_ROOT", Path(__file__).parents[1] / "public/builtin/aobai/motion"))


class BuiltinMotionTests(unittest.TestCase):
    def test_sleep_is_a_twelve_frame_lossless_loop_at_both_densities(self):
        root = MOTION_ROOT
        manifest = json.loads((root / "manifest.json").read_text())
        clip = manifest["clips"]["sleep"]
        self.assertEqual(clip["columns"], 4)
        self.assertEqual(len(clip["durations"]), 12)
        self.assertTrue(clip["loop"])
        self.assertNotIn("heldLoop", clip)
        self.assertNotIn("repeat", clip)
        for density, key in ((1, "file"), (2, "file2x")):
            with Image.open(root / clip[key]) as image:
                self.assertEqual(image.size, (4 * 208 * density, 3 * 208 * density))
                self.assertEqual(image.mode, "RGBA")

    def test_tail_thump_has_visible_local_motion_and_faster_downstroke(self):
        root = MOTION_ROOT
        timings = json.loads((root / "manifest.json").read_text())["clips"]["idle"]["durations"]
        self.assertLess(sum(timings[4:6]), sum(timings[1:4]) / 2)
        for density, suffix in ((1, ""), (2, "@2x")):
            size = 208 * density
            with Image.open(root / f"idle{suffix}.webp") as image:
                rest = np.asarray(image.convert("RGBA").crop((0, 0, size, size)))
                raised = np.asarray(image.convert("RGBA").crop((3 * size, 0, 4 * size, size)))
                changed = np.any(rest != raised, axis=2)
                ys, xs = np.where(changed)
                # 2026-09-15: the broad distal segment pivots at its left end.
                # A tiny moving tip cannot satisfy the approved coverage. These
                # bounds do not substitute for visual review of the motion arc.
                self.assertGreaterEqual(int(ys.max() - ys.min()), 25 * density)
                self.assertGreaterEqual(int(xs.max() - xs.min()), 45 * density)
                self.assertLessEqual(int(xs.min()), 60 * density)
                self.assertLessEqual(int(xs.max()), 113 * density)

    def test_tail_motion_locks_left_pivot_body_and_front_paws(self):
        root = MOTION_ROOT
        for density, suffix in ((1, ""), (2, "@2x")):
            size = 208 * density
            # The latest annotation supersedes the old x<78 freeze, which
            # prevented the broad tail from moving. Protect the left pivot,
            # higher tail root, head/body and the front paws independently.
            regions = [(0, 0, 208, 130), (0, 0, 40, 208),
                       (0, 110, 70, 138), (113, 130, 208, 208)]
            with Image.open(root / f"idle{suffix}.webp") as image:
                cells = [image.convert("RGBA").crop((i % 4 * size, i // 4 * size,
                         (i % 4 + 1) * size, (i // 4 + 1) * size)) for i in range(12)]
                for bounds in regions:
                    region = tuple(v * density for v in bounds)
                    expected = cells[0].crop(region).tobytes()
                    for index, cell in enumerate(cells[1:], 1):
                        if index in (8, 9, 10):  # Approved eyelid-only blink.
                            continue
                        self.assertEqual(cell.crop(region).tobytes(), expected,
                                         f"frame {index}: protected region {bounds} moved")

    def test_idle_blink_changes_only_the_local_eye_region(self):
        root = MOTION_ROOT
        for density, suffix in ((1, ""), (2, "@2x")):
            size = 208 * density
            with Image.open(root / f"idle{suffix}.webp") as image:
                rgba = image.convert("RGBA")
                rest = np.asarray(rgba.crop((0, 0, size, size)))
                for index in (8, 9, 10):
                    cell = np.asarray(rgba.crop((index % 4 * size, index // 4 * size,
                                                (index % 4 + 1) * size, (index // 4 + 1) * size)))
                    changed = np.any(rest != cell, axis=2)
                    ys, xs = np.where(changed)
                    self.assertGreater(len(xs), 0)
                    self.assertGreaterEqual(int(xs.min()), 88 * density)
                    self.assertLessEqual(int(xs.max()), 154 * density)
                    self.assertGreaterEqual(int(ys.min()), 45 * density)
                    self.assertLessEqual(int(ys.max()), 96 * density)

    def test_sleep_transition_endpoints_match_runtime_rest_poses(self):
        root = MOTION_ROOT
        manifest = json.loads((root / "manifest.json").read_text())
        for density, key in ((1, "file"), (2, "file2x")):
            size = 208 * density
            with Image.open(root / manifest["clips"]["idle"][key]) as idle, \
                    Image.open(root / manifest["clips"]["sleep"][key]) as sleep, \
                    Image.open(root / manifest["clips"]["sleep-enter"][key]) as enter, \
                    Image.open(root / manifest["clips"]["sleep-exit"][key]) as exit_atlas:
                idle_rest = idle.convert("RGBA").crop((0, 0, size, size)).tobytes()
                sleep_rest = sleep.convert("RGBA").crop((0, 0, size, size)).tobytes()
                enter_rgba = enter.convert("RGBA")
                exit_rgba = exit_atlas.convert("RGBA")
                self.assertEqual(enter_rgba.crop((0, 0, size, size)).tobytes(), idle_rest)
                last = len(manifest['clips']['sleep-enter']['durations'])-1
                columns = manifest['clips']['sleep-enter']['columns']
                x,y = last%columns*size,last//columns*size
                self.assertEqual(enter_rgba.crop((x,y,x+size,y+size)).tobytes(), sleep_rest)
                self.assertEqual(exit_rgba.crop((0, 0, size, size)).tobytes(), sleep_rest)
                last = len(manifest['clips']['sleep-exit']['durations'])-1
                columns = manifest['clips']['sleep-exit']['columns']
                x,y = last%columns*size,last//columns*size
                self.assertEqual(exit_rgba.crop((x,y,x+size,y+size)).tobytes(), idle_rest)

    def test_belly_recovery_and_idle_rest_are_the_same_pixels(self):
        root = MOTION_ROOT
        clip = json.loads((root/'manifest.json').read_text())['clips']['belly']
        for density, suffix in ((1, ""), (2, "@2x")):
            size = 208 * density
            with Image.open(root / f"belly{suffix}.webp") as belly, Image.open(root / f"idle{suffix}.webp") as idle:
                last = len(clip['durations'])-1
                x,y = last%clip['columns']*size,last//clip['columns']*size
                rest = belly.convert("RGBA").crop((x,y,x+size,y+size))
                self.assertEqual(idle.convert("RGBA").crop((0, 0, size, size)).tobytes(), rest.tobytes())
                self.assertEqual(idle.convert("RGBA").crop((3 * size, 2 * size, 4 * size, 3 * size)).tobytes(), rest.tobytes())

    def test_all_transitional_motions_seamlessly_connect_to_idle_rest(self):
        root = MOTION_ROOT
        manifest = json.loads((root / "manifest.json").read_text())
        for density, key in ((1, "file"), (2, "file2x")):
            size = 208 * density
            with Image.open(root / manifest["clips"]["idle"][key]) as idle:
                idle_rest = idle.convert("RGBA").crop((0, 0, size, size)).tobytes()

            for name in ("running", "waving", "belly", "review", "sleep-enter"):
                clip = manifest["clips"][name]
                with Image.open(root / clip[key]) as img:
                    f0 = img.convert("RGBA").crop((0, 0, size, size)).tobytes()
                    self.assertEqual(f0, idle_rest, f"{name} F0 does not match idle_rest at {density}x")

            for name in ("running", "waving", "belly", "review", "sleep-exit"):
                clip = manifest["clips"][name]
                cols = clip["columns"]
                count = len(clip["durations"])
                last_idx = count - 1
                c = last_idx % cols
                r = last_idx // cols
                with Image.open(root / clip[key]) as img:
                    flast = img.convert("RGBA").crop((c * size, r * size, (c + 1) * size, (r + 1) * size)).tobytes()
                    self.assertEqual(flast, idle_rest, f"{name} Flast does not match idle_rest at {density}x")

    def test_zero_pink_fringe_across_all_builtin_motions(self):
        root = MOTION_ROOT
        manifest = json.loads((root / "manifest.json").read_text())
        for name, clip in manifest["clips"].items():
            for density, key in ((1, "file"), (2, "file2x")):
                with Image.open(root / clip[key]) as img:
                    arr = np.array(img.convert("RGBA"))
                    rgb = arr[:, :, :3].astype(np.int32)
                    alpha = arr[:, :, 3]
                    pink = (alpha > 20) & (rgb[:, :, 0] > 180) & (rgb[:, :, 2] > 150) & (rgb[:, :, 0] - rgb[:, :, 1] > 40) & (rgb[:, :, 2] - rgb[:, :, 1] > 30)
                    self.assertEqual(int(np.sum(pink)), 0, f"{name} has {np.sum(pink)} pink fringe pixels at {density}x")

    def test_manifest_matches_nonempty_padded_frames_and_empty_unused_cells(self):
        root = MOTION_ROOT
        manifest = json.loads((root / "manifest.json").read_text())
        for name, clip in manifest["clips"].items():
            for density, key in ((1, "file"), (2, "file2x")):
                with self.subTest(action=name, density=density):
                    size = manifest["size"] * density
                    columns = clip["columns"]
                    count = len(clip["durations"])
                    rows = (count + columns - 1) // columns
                    with Image.open(root / clip[key]) as image:
                        self.assertEqual(image.size, (columns * size, rows * size))
                        alpha = image.convert("RGBA").getchannel("A")
                        for index in range(rows * columns):
                            x, y = index % columns * size, index // columns * size
                            box = alpha.crop((x, y, x + size, y + size)).getbbox()
                            if index >= count:
                                self.assertIsNone(box)
                            else:
                                self.assertIsNotNone(box)
                                self.assertGreaterEqual(min(box[0], box[1], size - box[2], size - box[3]), 3 * density)

    def test_sleep_transition_orientation_is_consistent_and_monotonic(self):
        root = MOTION_ROOT
        count = len(json.loads((root / 'manifest.json').read_text())['clips']['sleep-enter']['durations'])
        for density, suffix in ((1, ""), (2, "@2x")):
            size = 208 * density
            with Image.open(root / f"sleep-enter{suffix}.webp") as enter_img:
                alpha = enter_img.convert("RGBA").getchannel("A")
                prev_top = 0
                for i in range(count):
                    c = i % 4
                    r = i // 4
                    cell_a = alpha.crop((c * size, r * size, (c + 1) * size, (r + 1) * size))
                    box = cell_a.point(lambda v: 255 if v > 16 else 0).getbbox()
                    self.assertIsNotNone(box)
                    # Baseline must stay firmly grounded
                    self.assertEqual(box[3], 193 * density)
                    # Head/top must lower monotonically during sleep-enter
                    self.assertGreaterEqual(box[1], prev_top)
                    prev_top = box[1]

    def test_groom_forehead_has_no_pink_artifacts(self):
        root = MOTION_ROOT
        count = len(json.loads((root / 'manifest.json').read_text())['clips']['waving']['durations'])
        for density, suffix in ((1, ""), (2, "@2x")):
            size = 208 * density
            with Image.open(root / f"groom{suffix}.webp") as groom_img:
                arr = np.array(groom_img.convert("RGBA"))
                for i in range(count):
                    c = i % 4
                    r = i // 4
                    cell = arr[r * size:(r + 1) * size, c * size:(c + 1) * size]
                    # Check forehead area (y < 70*density) for abnormal saturated pink
                    forehead = cell[:int(70 * density), :]
                    pink_artifact = (forehead[:, :, 3] > 50) & (forehead[:, :, 0] > 200) & (forehead[:, :, 1] < 160) & (forehead[:, :, 2] > 130) & (forehead[:, :, 0] - forehead[:, :, 1] > 50)
                    self.assertEqual(int(np.sum(pink_artifact)), 0, f"groom frame {i} has pink forehead artifact at {density}x")

    def test_groom_whiskers_and_paw_are_not_recolored_as_tongue(self):
        # The old mouth rectangle recolored dark whisker/paw pixels at x>=109.
        # The real tongue is to its left; preserve it rather than banning pink
        # everywhere (which would also erase normal nose/ear/tongue colors).
        body_start, body_end, _ = json.loads((MOTION_ROOT / 'manifest.json').read_text())['clips']['waving']['repeat']
        for density, suffix in ((1, ""), (2, "@2x")):
            size = 208 * density
            with Image.open(MOTION_ROOT / f"groom{suffix}.webp") as image:
                atlas = np.asarray(image.convert("RGBA"), dtype=np.int16)
                for i in range(body_start, body_end + 1):
                    frame = atlas[i // 4 * size:(i // 4 + 1) * size,
                                  i % 4 * size:(i % 4 + 1) * size]
                    region = frame[70 * density:90 * density, 109 * density:125 * density]
                    pink = ((region[:, :, 3] > 120) & (region[:, :, 0] > 180)
                            & (region[:, :, 0] - region[:, :, 1] > 50)
                            & (region[:, :, 2] > 120))
                    self.assertEqual(int(pink.sum()), 0, f"groom {i} has pink whisker/paw artifacts at {density}x")

    def test_retina_transition_edges_have_antialiased_alpha(self):
        # Catch opaque-to-transparent cutout borders, especially the stretched
        # belly/feet/tail. This is an edge gate, not a substitute for fur QA.
        manifest = json.loads((MOTION_ROOT / "manifest.json").read_text())
        for name in ("waving", "review", "running", "belly", "sleep-enter", "sleep-exit"):
            clip = manifest["clips"][name]
            size = 416
            with Image.open(MOTION_ROOT / clip["file2x"]) as image:
                alpha = np.asarray(image.getchannel("A"), dtype=np.int16)
                for i in range(len(clip["durations"])):
                    cell = alpha[i // clip["columns"] * size:(i // clip["columns"] + 1) * size,
                                 i % clip["columns"] * size:(i % clip["columns"] + 1) * size]
                    hard = int((abs(np.diff(cell, axis=0)) > 200).sum()
                               + (abs(np.diff(cell, axis=1)) > 200).sum())
                    self.assertEqual(hard, 0, f"{name} {i} has {hard} hard alpha cutouts at 2x")

    def test_stretch_tail_tips_are_not_vertical_source_crop_edges(self):
        count = len(json.loads((MOTION_ROOT/'manifest.json').read_text())['clips']['review']['durations'])
        for density, suffix in ((1, ""), (2, "@2x")):
            size = 208 * density
            with Image.open(MOTION_ROOT / f"stretch{suffix}.webp") as image:
                alpha = np.asarray(image.getchannel("A"))
                for i in range(count-5,count-2):
                    cell = alpha[i // 4 * size:(i // 4 + 1) * size,
                                 i % 4 * size:(i % 4 + 1) * size]
                    # The severed source tails had 40–48 logical pixels of
                    # perfectly vertical right edge. Complete curved tips
                    # should not retain that long rectangular crop signature.
                    previous, run, longest = -1, 0, 0
                    for row in cell[:105 * density, 155 * density:]:
                        xs = np.flatnonzero(row > 32)
                        right = int(xs[-1]) if len(xs) else -1
                        run = run + 1 if right == previous and right >= 0 else int(right >= 0)
                        longest = max(longest, run)
                        previous = right
                    self.assertLess(longest, 25 * density,
                                    f"stretch {i} has a vertical cropped tail at {density}x")


if __name__ == "__main__":
    unittest.main()
