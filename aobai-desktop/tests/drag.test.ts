import { describe, expect, it } from "vitest";
import {
  draggedWindowPosition,
  shouldUseManualWindowDrag,
} from "../src/platform/drag";

describe("draggedWindowPosition", () => {
  it("converts CSS pointer movement to physical window pixels", () => {
    expect(
      draggedWindowPosition(
        { x: 300, y: 450 },
        { x: 100, y: 120 },
        { x: 140, y: 100 },
        1.5,
      ),
    ).toEqual({ x: 360, y: 420 });
  });

  it("falls back to scale one for an invalid DPI value", () => {
    expect(
      draggedWindowPosition(
        { x: 10, y: 20 },
        { x: 2, y: 3 },
        { x: 7, y: 9 },
        0,
      ),
    ).toEqual({ x: 15, y: 26 });
  });

  it("uses captured DPI-aware dragging on Windows and macOS", () => {
    expect(
      shouldUseManualWindowDrag(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ),
    ).toBe(true);
    expect(
      shouldUseManualWindowDrag(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      ),
    ).toBe(true);
    expect(shouldUseManualWindowDrag("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
  });

  it("moves left and back on a Retina display without coordinate drift", () => {
    const origin = { x: 3662, y: 2064 };
    const start = { x: 1927, y: 1136 };
    expect(draggedWindowPosition(origin, start, { x: 1867, y: 1136 }, 2))
      .toEqual({ x: 3542, y: 2064 });
    expect(draggedWindowPosition(origin, start, start, 2)).toEqual(origin);
  });
});
