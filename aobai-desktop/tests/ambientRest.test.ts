import { describe, expect, it } from "vitest";
import { AmbientRest } from "../src/behavior/ambientRest";

describe("ambient quiet time after returning to rest", () => {
  it("does not spend the quiet interval while a long action is playing", () => {
    const rest = new AmbientRest();
    const poll = (idle: boolean, now: number) => rest.poll("normal", idle, now, () => 0);
    expect(poll(true, 0)).toBe(false);
    expect(poll(false, 29_000)).toBe(false);
    expect(poll(false, 80_000)).toBe(false);
    expect(poll(true, 81_000)).toBe(false);
    expect(poll(true, 110_999)).toBe(false);
    expect(poll(true, 111_000)).toBe(true);
  });

  it("restarts after holding, hiding or a mode change, without firing on resume", () => {
    const rest = new AmbientRest();
    rest.poll("active", true, 0, () => 0);
    rest.poll("active", false, 14_000, () => 0);
    expect(rest.poll("active", true, 500_000, () => 0)).toBe(false);
    expect(rest.poll("normal", true, 510_000, () => 0)).toBe(false);
    expect(rest.poll("normal", true, 539_999, () => 0)).toBe(false);
    expect(rest.poll("normal", true, 540_000, () => 0)).toBe(true);
  });

  it("leaves quiet mode stopped and rate-limits idle decisions and failures", () => {
    const rest = new AmbientRest();
    expect(rest.poll("quiet", true, 0, () => 0)).toBe(false);
    expect(rest.poll("quiet", true, 999_999, () => 0)).toBe(false);
    expect(rest.poll("active", true, 1_000_000, () => 0)).toBe(false);
    expect(rest.poll("active", true, 1_015_000, () => 0)).toBe(true);
    expect(rest.poll("active", true, 1_015_001, () => 0)).toBe(false);
    expect(rest.poll("active", true, 1_030_000, () => 0)).toBe(true);
  });
});
