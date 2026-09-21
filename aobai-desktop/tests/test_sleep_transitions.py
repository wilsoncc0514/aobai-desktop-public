"""Unit checks for deterministic transition-asset normalization."""
import importlib.util
from pathlib import Path
import unittest

from PIL import Image, ImageDraw


SCRIPT = Path(__file__).parents[1] / "scripts/build-sleep-transitions.py"
SPEC = importlib.util.spec_from_file_location("build_sleep_transitions", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SleepTransitionBuildTests(unittest.TestCase):
    def test_detached_generated_fragment_is_removed(self):
        source = Image.new("RGBA", (100, 100))
        draw = ImageDraw.Draw(source)
        draw.ellipse((20, 20, 80, 90), fill=(90, 70, 50, 255))
        draw.rectangle((2, 2, 4, 8), fill=(255, 0, 0, 255))

        cleaned = MODULE.keep_main_component(source)

        self.assertEqual(cleaned.getpixel((3, 4))[3], 0)
        self.assertEqual(cleaned.getpixel((50, 50))[3], 255)

    def test_split_grid_rejects_empty_frame(self):
        source = Image.new("RGBA", (200, 100))
        ImageDraw.Draw(source).rectangle((10, 10, 80, 80), fill="white")
        with self.assertRaisesRegex(ValueError, "frame 1 is empty"):
            MODULE.split_grid(source, 2, 1, 2)

    def test_alignment_interpolates_bounds_and_keeps_exact_endpoints(self):
        start = Image.new("RGBA", (100, 100))
        end = Image.new("RGBA", (100, 100))
        ImageDraw.Draw(start).rectangle((20, 10, 59, 89), fill="white")
        ImageDraw.Draw(end).rectangle((10, 40, 89, 79), fill="white")
        cells = [start.copy() for _ in range(3)]

        aligned = MODULE.align_between_endpoints(cells, start, end)

        self.assertEqual(aligned[0].tobytes(), start.tobytes())
        self.assertEqual(aligned[-1].tobytes(), end.tobytes())
        self.assertEqual(MODULE.visible_bbox(aligned[1]), (15, 25, 75, 85))


if __name__ == "__main__":
    unittest.main()
