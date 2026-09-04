import { describe, expect, it } from "vitest";
import { contextMenuXOffset } from "../src/platform/menuPlacement";

describe("context menu placement", () => {
  const monitor = { x: 0, y: 0, width: 1440, height: 900 };

  it("opens to the right when enough space is available", () => {
    expect(contextMenuXOffset({ x: 300, y: 200, width: 240, height: 260 }, monitor)).toBe(250);
  });

  it("opens to the left near the right edge", () => {
    expect(contextMenuXOffset({ x: 1200, y: 200, width: 240, height: 260 }, monitor)).toBe(-230);
  });

  it("supports monitors with negative coordinates", () => {
    const leftMonitor = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(
      contextMenuXOffset({ x: -300, y: 200, width: 240, height: 260 }, leftMonitor),
    ).toBe(-230);
  });

  it("keeps enough physical distance on a Retina display", () => {
    const retinaMonitor = { x: 0, y: 0, width: 4096, height: 2560 };
    expect(
      contextMenuXOffset({ x: 3616, y: 400, width: 480, height: 520 }, retinaMonitor, 2),
    ).toBe(-460);
  });
});
