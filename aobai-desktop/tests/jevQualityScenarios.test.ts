import { describe, expect, it } from "vitest";
import { BEHAVIOR_ACTIONS } from "../src/behavior/actions";
import { AmbientDecisionGate } from "../src/behavior/ambientDecisionGate";
import { DecisionTrace } from "../src/behavior/decisionTrace";
import { JevDecisionProvider } from "../src/behavior/jevDecisionProvider";
import { QUALITY_SCENARIOS, compareQualityScenarios } from "../src/behavior/qualityScenarios";
import { RuleDecisionProvider } from "../src/behavior/ruleDecisionProvider";

describe("synthetic behavior quality comparison baseline", () => {
  it("keeps all six contexts fixed, anonymous, and Rule actions available", () => {
    const rule = new RuleDecisionProvider();
    expect(QUALITY_SCENARIOS).toHaveLength(6);
    for (const scenario of QUALITY_SCENARIOS) {
      const action = rule.decide(scenario.context, BEHAVIOR_ACTIONS, 0.5);
      expect(BEHAVIOR_ACTIONS).toContain(action);
      expect(Object.keys(scenario.context).sort()).toEqual(Object.keys(QUALITY_SCENARIOS[0].context).sort());
    }
  });

  it("uses identical action availability and stops after interaction", async () => {
    const gate = new AmbientDecisionGate();
    const trace = new DecisionTrace();
    const transport = async (input: { availableActions: readonly string[] }) => {
      expect(input.availableActions).toEqual(BEHAVIOR_ACTIONS);
      gate.invalidate();
      return "idle";
    };
    const results = await compareQualityScenarios(new JevDecisionProvider(transport, undefined, trace), trace, gate, () => true);
    expect(results).toHaveLength(1);
    expect(results[0]?.scenario).toBe("day-normal");
  });

  it("takes five lightweight samples for every fixed scenario", async () => {
    const gate = new AmbientDecisionGate();
    const trace = new DecisionTrace();
    const provider = new JevDecisionProvider(async () => "stretch", undefined, trace);
    const results = await compareQualityScenarios(provider, trace, gate, () => true);
    expect(results).toHaveLength(30);
    for (const scenario of QUALITY_SCENARIOS) {
      const samples = results.filter((result) => result.scenario === scenario.name);
      expect(samples).toHaveLength(5);
      expect(samples.map((result) => result.sample)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("does not call Jev when disabled or when another decision is pending", async () => {
    const gate = new AmbientDecisionGate();
    const trace = new DecisionTrace();
    let calls = 0;
    const provider = new JevDecisionProvider(async () => { calls++; return "idle"; }, undefined, trace);
    expect(await compareQualityScenarios(provider, trace, gate, () => false)).toEqual([]);
    const pending = gate.begin();
    await expect(compareQualityScenarios(provider, trace, gate, () => true)).rejects.toThrow("in progress");
    gate.finish(pending!);
    expect(calls).toBe(0);
  });
});
