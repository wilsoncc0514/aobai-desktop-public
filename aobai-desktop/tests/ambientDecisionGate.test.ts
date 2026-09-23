import { describe, expect, it } from "vitest";
import { AmbientDecisionGate } from "../src/behavior/ambientDecisionGate";

describe("ambient Jev request gate", () => {
  it("discards a result after interaction and never overlaps requests", () => {
    const gate = new AmbientDecisionGate();
    const first = gate.begin();
    expect(first).not.toBeNull();
    expect(gate.begin()).toBeNull();
    gate.invalidate();
    expect(gate.begin()).toBeNull();
    expect(gate.finish(first!)).toBe(false);
    const next = gate.begin();
    expect(next).not.toBeNull();
    expect(gate.finish(first!)).toBe(false);
    expect(gate.begin()).toBeNull();
    expect(gate.finish(next!)).toBe(true);
  });

  it("releases the next ambient decision after a failed request", () => {
    const gate = new AmbientDecisionGate();
    const failed = gate.begin();
    expect(failed).not.toBeNull();
    gate.finish(failed!);
    const next = gate.begin();
    expect(next).not.toBeNull();
    expect(gate.finish(next!)).toBe(true);
  });
});
