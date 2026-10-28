import { describe, expect, it } from "vitest";
import { hasReachableArea } from "../src/platform/windowPosition";

const size = { width: 208, height: 208 };
const monitors = [
  { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
  { position: { x: -1920, y: 0 }, size: { width: 1920, height: 1080 } },
];

describe("saved window position", () => {
  it("keeps positions with at least half the pet reachable", () => {
    expect(hasReachableArea({ x: 1816, y: 200 }, size, monitors)).toBe(true);
    expect(hasReachableArea({ x: -1800, y: 200 }, size, monitors)).toBe(true);
  });

  it("rejects a pet visible by only one pixel", () => {
    expect(hasReachableArea({ x: 1919, y: 200 }, size, monitors)).toBe(false);
  });

  it("rejects a position on a disconnected monitor", () => {
    expect(hasReachableArea({ x: 2500, y: 200 }, size, monitors)).toBe(false);
  });
});
