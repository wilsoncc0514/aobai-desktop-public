import { invoke, isTauri } from "@tauri-apps/api/core";
import type { BehaviorDecisionProvider } from "./decision";
import { JevDecisionProvider, type JevDecisionInput } from "./jevDecisionProvider";
import { RuleDecisionProvider } from "./ruleDecisionProvider";
import type { DecisionTrace } from "./decisionTrace";

export type BehaviorProvider = "rule" | "jev";

export function createBehaviorDecisionProvider(
  behaviorProvider: BehaviorProvider = "rule",
  transport: (input: JevDecisionInput) => Promise<unknown> = (input) =>
    invoke("jev_decide", { input }),
  trace?: DecisionTrace,
): BehaviorDecisionProvider {
  const rule = new RuleDecisionProvider();
  return behaviorProvider === "jev" ? new JevDecisionProvider(transport, rule, trace) : rule;
}

export async function configuredBehaviorProvider(): Promise<BehaviorProvider> {
  if (!isTauri()) return "rule";
  try {
    return await invoke<unknown>("behavior_provider") === "jev" ? "jev" : "rule";
  } catch {
    console.warn("行为 Provider 配置不可用，使用本地规则");
    return "rule";
  }
}
