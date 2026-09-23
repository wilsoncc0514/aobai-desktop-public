import { describe, expect, it, vi } from "vitest";
import type { PetContext } from "../src/behavior/context";
import { JevDecisionProvider } from "../src/behavior/jevDecisionProvider";
import { createBehaviorDecisionProvider } from "../src/behavior/provider";
import { RuleDecisionProvider } from "../src/behavior/ruleDecisionProvider";

const context: PetContext = {
  mode: "normal",
  currentAction: "idle",
  previousAction: null,
  recentActions: ["groom"],
  secondsSinceLastAmbientAction: 30,
  secondsSinceUserInteraction: 60,
  hour: 12,
};
const available = ["idle", "groom", "sleep"] as const;
const sample = 0.5;
const expectedFallback = new RuleDecisionProvider().decide(context, available, sample);

describe("optional Jev decision provider", () => {
  it("uses synchronous local rules by default without invoking transport", () => {
    const transport = vi.fn();
    const provider = createBehaviorDecisionProvider(undefined, transport);
    expect(provider).toBeInstanceOf(RuleDecisionProvider);
    expect(provider.decide(context, available, sample)).toBe(expectedFallback);
    expect(transport).not.toHaveBeenCalled();
  });

  it("stays offline when explicitly disabled", () => {
    const transport = vi.fn();
    createBehaviorDecisionProvider("rule", transport).decide(context, available, sample);
    expect(transport).not.toHaveBeenCalled();
  });

  it("sends only allowlisted input and accepts an available action", async () => {
    const transport = vi.fn().mockResolvedValue("sleep");
    const provider = new JevDecisionProvider(transport);
    expect(await provider.decide({ ...context, extraPrivateField: "secret" } as PetContext, available, sample)).toBe("sleep");
    expect(transport).toHaveBeenCalledWith({
      mode: "normal", hour: 12, recentActions: ["groom"],
      secondsSinceLastAmbientAction: 30, secondsSinceUserInteraction: 60,
      availableActions: available,
    });
  });

  it.each(["drag", "SLEEP", null, {}, { action: "sleep" }, "stretch"])(
    "falls back on invalid or unavailable result %j", async (result) => {
      const provider = new JevDecisionProvider(vi.fn().mockResolvedValue(result));
      expect(await provider.decide(context, available, sample)).toBe(expectedFallback);
    },
  );

  it.each(["missing key", "network error", "timeout", "provider exception"])(
    "falls back on %s", async (reason) => {
      const provider = new JevDecisionProvider(vi.fn().mockRejectedValue(new Error(reason)));
      expect(await provider.decide(context, available, sample)).toBe(expectedFallback);
    },
  );

  it("falls back without sending when no actions are available", async () => {
    const transport = vi.fn();
    await new JevDecisionProvider(transport).decide(context, [], sample);
    expect(transport).not.toHaveBeenCalled();
  });

  it("creates JevDecisionProvider when enabled, and RuleDecisionProvider when disabled", () => {
    const transport = vi.fn();
    const jevProvider = createBehaviorDecisionProvider("jev", transport);
    expect(jevProvider).toBeInstanceOf(JevDecisionProvider);

    const ruleProvider = createBehaviorDecisionProvider("rule", transport);
    expect(ruleProvider).toBeInstanceOf(RuleDecisionProvider);
    expect(ruleProvider.decide(context, available, sample)).toBe(expectedFallback);
    expect(transport).not.toHaveBeenCalled();
  });
});
