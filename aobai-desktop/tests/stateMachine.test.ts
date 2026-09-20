import { describe, expect, it } from "vitest";
import manifest from "../public/builtin/aobai/motion/manifest.json";
import {
  nextAmbientDelayMs,
  selectAmbientAction,
} from "../src/behavior/stateMachine";

describe("desktop pet behavior", () => {
  it("reduces bundled kneading weight without changing legacy behavior", () => {
    const available = Object.keys(manifest.clips);
    for (const [mode, expected] of [["normal", 0.125], ["active", 20 / 161]] as const) {
      let knead = 0;
      for (let i = 0; i < 10000; i++) {
        if (selectAmbientAction(mode, i / 10000, null, available) === "running") knead++;
      }
      expect(knead / 10000).toBeCloseTo(expected, 3);
    }
    expect(selectAmbientAction("normal", 0.75)).toBe("running");
  });
  it("never mixes legacy poses into the loaded motion pack", () => {
    const available = Object.keys(manifest.clips);
    for (const mode of ["normal", "active"] as const) {
      const observed = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const action = selectAmbientAction(mode, i / 1000, null, available);
        expect(available).toContain(action);
        observed.add(action);
        expect(selectAmbientAction(mode, i / 1000, action, available)).not.toBe(action);
      }
      expect([...observed].sort()).toEqual(["review", "running", "waving"]);
    }
  });

  it("rests when no ambient clip is available and tolerates a single clip", () => {
    expect(selectAmbientAction("active", 0.9, null, [])).toBe("idle");
    expect(selectAmbientAction("active", 0.9, "waving", ["waving"])).toBe("waving");
  });
  it("never schedules ambient actions in quiet mode", () => {
    expect(nextAmbientDelayMs("quiet", 0.5)).toBeNull();
    expect(selectAmbientAction("quiet", 0.5)).toBe("idle");
  });

  it("keeps ambient delays inside the mode budget", () => {
    expect(nextAmbientDelayMs("normal", 0)).toBe(30_000);
    expect(nextAmbientDelayMs("normal", 1)).toBe(70_000);
    expect(nextAmbientDelayMs("active", 0)).toBe(15_000);
    expect(nextAmbientDelayMs("active", 1)).toBe(35_000);
  });

  it("keeps directional running out of autonomous behavior and avoids repeats", () => {
    for (const mode of ["normal", "active"] as const) {
      const observed = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const state = selectAmbientAction(mode, i / 1000);
        observed.add(state);
        expect(state).not.toMatch(/^running-/);
        expect(selectAmbientAction(mode, i / 1000, state)).not.toBe(state);
      }
      expect([...observed].sort()).toEqual(["failed", "jumping", "review", "running", "waiting", "waving"]);
    }
  });

  it("recovers from invalid random samples without an immediate timer loop", () => {
    expect(nextAmbientDelayMs("normal", Number.NaN)).toBe(30_000);
    expect(selectAmbientAction("normal", Number.NaN)).toBe("review");
  });

});
