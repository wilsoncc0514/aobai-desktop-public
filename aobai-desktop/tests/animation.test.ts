import { describe, expect, it } from "vitest";
import { ANIMATIONS } from "../src/animation/catalog";
import { advanceFrame } from "../src/animation/player";

describe("advanceFrame", () => {
  it("loops idle animation", () => {
    expect(advanceFrame(ANIMATIONS.idle, 5)).toEqual({ frameIndex: 0, completed: false });
  });

  it("holds the final frame and completes a one-shot animation", () => {
    expect(advanceFrame(ANIMATIONS.waving, 3)).toEqual({ frameIndex: 3, completed: true });
  });

  it("recovers from an invalid frame index", () => {
    expect(advanceFrame(ANIMATIONS.idle, 99)).toEqual({ frameIndex: 0, completed: false });
  });

  it("matches the Codex pet v2 row and frame contract", () => {
    expect(
      Object.values(ANIMATIONS).map(({ state, row, frameCount }) => ({ state, row, frameCount })),
    ).toEqual([
      { state: "idle", row: 0, frameCount: 6 },
      { state: "running-right", row: 1, frameCount: 8 },
      { state: "running-left", row: 2, frameCount: 8 },
      { state: "waving", row: 3, frameCount: 4 },
      { state: "jumping", row: 4, frameCount: 5 },
      { state: "failed", row: 5, frameCount: 8 },
      { state: "waiting", row: 6, frameCount: 6 },
      { state: "running", row: 7, frameCount: 6 },
      { state: "review", row: 8, frameCount: 6 },
    ]);
  });

  it("defines an explicit duration for every frame", () => {
    for (const definition of Object.values(ANIMATIONS)) {
      expect(definition.frameDurationsMs).toHaveLength(definition.frameCount);
      expect(definition.frameDurationsMs.every((duration) => duration >= 100)).toBe(true);
    }
  });

  it("leaves time to rest and observe the longer cat behaviors", () => {
    const duration = (state: keyof typeof ANIMATIONS) =>
      ANIMATIONS[state].frameDurationsMs.reduce((sum, ms) => sum + ms, 0);
    expect(duration("idle")).toBeGreaterThanOrEqual(7_000);
    expect(duration("failed")).toBeGreaterThanOrEqual(12_000);
    expect(duration("running")).toBeGreaterThanOrEqual(3_000);
    expect(duration("waving")).toBeGreaterThanOrEqual(3_000);
  });
});
