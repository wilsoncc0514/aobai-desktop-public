import { BEHAVIOR_ACTIONS } from "./actions";
import type { PetContext } from "./context";
import type { BehaviorDecisionProvider } from "./decision";
import { RuleDecisionProvider } from "./ruleDecisionProvider";
import { AmbientDecisionGate } from "./ambientDecisionGate";
import { DecisionTrace } from "./decisionTrace";

const base: PetContext = {
  mode: "normal", currentAction: "idle", previousAction: null,
  recentActions: [], secondsSinceLastAmbientAction: 90,
  secondsSinceUserInteraction: 300, hour: 12,
};

export const QUALITY_SCENARIOS = [
  { name: "day-normal", context: base },
  { name: "night-normal", context: { ...base, hour: 23 } },
  { name: "active", context: { ...base, mode: "active" as const } },
  { name: "recent-sleep", context: { ...base, previousAction: "sleep" as const, recentActions: ["sleep" as const], secondsSinceLastAmbientAction: 20 } },
  { name: "recent-interaction", context: { ...base, secondsSinceUserInteraction: 2 } },
  { name: "long-inactivity", context: { ...base, secondsSinceLastAmbientAction: 600, secondsSinceUserInteraction: 3_600 } },
] as const;

/** Dev-only, explicit six-request comparison; synthetic context never includes user data. */
export async function compareQualityScenarios(
  jev: BehaviorDecisionProvider,
  trace: DecisionTrace,
  gate: AmbientDecisionGate,
  enabled: () => boolean,
  samplesPerScenario = 5,
) {
  const generation = gate.begin();
  if (generation === null) throw new Error("ambient decision in progress");
  const rule = new RuleDecisionProvider();
  const results = [];
  try {
    const boundedSamples = Math.max(1, Math.floor(samplesPerScenario));
    for (const scenario of QUALITY_SCENARIOS) {
      for (let sample = 1; sample <= boundedSamples; sample++) {
        if (!gate.isCurrent(generation) || !enabled()) return results;
        const ruleAction = rule.decide(scenario.context, BEHAVIOR_ACTIONS, 0.5);
        const jevAction = await jev.decide(scenario.context, BEHAVIOR_ACTIONS, 0.5);
        const entries = trace.snapshot();
        const entry = entries[entries.length - 1];
        results.push({
          scenario: scenario.name, sample, ruleAction, jevAction,
          provider: entry?.provider ?? "fallback",
          latencyMs: entry?.latencyMs ?? 0,
          fallbackReason: entry?.fallbackReason ?? null,
        });
      }
    }
    return results;
  } finally {
    gate.finish(generation);
  }
}
