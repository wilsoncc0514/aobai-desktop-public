import { describe, expect, it, vi } from "vitest";
import { DecisionTrace } from "../src/behavior/decisionTrace";
import { JevDecisionProvider } from "../src/behavior/jevDecisionProvider";
import type { PetContext } from "../src/behavior/context";

const context: PetContext = {
  mode: "normal", currentAction: "idle", previousAction: null,
  recentActions: [], secondsSinceLastAmbientAction: 30,
  secondsSinceUserInteraction: 60, hour: 12,
};
const actions = ["idle", "groom"] as const;

describe("development decision trace", () => {
  it("bounds entries and copies only non-sensitive fields", () => {
    const trace = new DecisionTrace();
    for (let index = 0; index < 21; index++) {
      trace.record({
        provider: "jev", availableActions: actions, selectedAction: "idle",
        latencyMs: index, fallbackReason: null, timestamp: index,
        apiKey: "private-token", Authorization: "Bearer private-token",
      } as Parameters<DecisionTrace["record"]>[0]);
    }
    const snapshot = trace.snapshot();
    expect(snapshot).toHaveLength(20);
    expect(snapshot[0]?.timestamp).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain("private-token");
    expect(JSON.stringify(snapshot)).not.toContain("Authorization");
    trace.record({
      provider: "fallback", availableActions: actions, selectedAction: "idle",
      latencyMs: 1, fallbackReason: "Bearer private-token", timestamp: 22,
    } as unknown as Parameters<DecisionTrace["record"]>[0]);
    expect(trace.snapshot()[trace.snapshot().length - 1]?.fallbackReason).toBe("other");
    expect(JSON.stringify(trace.snapshot())).not.toContain("private-token");
  });

  it("records a safe fallback reason and allows the next request", async () => {
    const trace = new DecisionTrace();
    const transport = vi.fn()
      .mockRejectedValueOnce(new Error("401 Authorization Bearer private-token"))
      .mockResolvedValueOnce("groom");
    const provider = new JevDecisionProvider(transport, undefined, trace);
    await provider.decide(context, actions, 0.5);
    expect(await provider.decide(context, actions, 0.5)).toBe("groom");
    expect(trace.snapshot().map((entry) => entry.provider)).toEqual(["fallback", "jev"]);
    expect(trace.snapshot()[0]?.fallbackReason).toBe("unauthorized");
    expect(JSON.stringify(trace.snapshot())).not.toContain("private-token");
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
