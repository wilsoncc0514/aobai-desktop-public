"""Regression checks for Windows PowerShell 5.1 packaging compatibility."""
from pathlib import Path
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts" / "build-release-windows.ps1"


class WindowsPackagingTests(unittest.TestCase):
    def test_packaging_script_is_ascii_for_windows_powershell_51(self):
        data = SCRIPT.read_bytes()
        self.assertTrue(data.isascii())
        self.assertFalse(data.startswith(b"\xef\xbb\xbf"))

    def test_unicode_paths_and_native_exit_codes_are_explicit(self):
        script = SCRIPT.read_text(encoding="ascii")
        self.assertIn(r"\u9ccc\u62dc\u00b7\u684c\u9762\u5ba0\u7269-windows", script)
        self.assertIn(r"\u542f\u52a8\u9ccc\u62dc.bat", script)
        self.assertIn(r"\u53cc\u51fb\u542f\u52a8\u9ccc\u62dc.bat", script)
        self.assertIn("$LASTEXITCODE -ne 0", script)


if __name__ == "__main__":
    unittest.main()
