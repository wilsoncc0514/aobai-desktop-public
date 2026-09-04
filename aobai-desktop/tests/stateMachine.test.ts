import { describe, expect, it } from "vitest";
import {
  nextAmbientDelayMs,
  selectAmbientAction,
} from "../src/behavior/stateMachine";

describe("desktop pet behavior", () => {
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
