import type { BehaviorAction } from "./actions";
import { BEHAVIOR_ACTIONS } from "./actions";
import type { PetContext } from "./context";
import type { BehaviorDecisionProvider } from "./decision";
import { RuleDecisionProvider } from "./ruleDecisionProvider";
import { classifyFallback, type DecisionTrace } from "./decisionTrace";

export interface JevDecisionInput {
  mode: PetContext["mode"];
  hour: number;
  recentActions: readonly BehaviorAction[];
  secondsSinceLastAmbientAction: number;
  secondsSinceUserInteraction: number;
  availableActions: readonly BehaviorAction[];
}

export type JevTransport = (input: JevDecisionInput) => Promise<unknown>;

export class JevDecisionProvider implements BehaviorDecisionProvider {
  constructor(
    private readonly transport: JevTransport,
    private readonly fallback: BehaviorDecisionProvider = new RuleDecisionProvider(),
    private readonly trace?: DecisionTrace,
  ) {}

  async decide(
    context: PetContext,
    availableActions: readonly BehaviorAction[],
    sample: number,
  ): Promise<BehaviorAction> {
    // Construct a new allowlisted object; never pass the full context to the backend.
    const input: JevDecisionInput = {
      mode: context.mode,
      hour: context.hour,
      recentActions: context.recentActions,
      secondsSinceLastAmbientAction: context.secondsSinceLastAmbientAction,
      secondsSinceUserInteraction: context.secondsSinceUserInteraction,
      availableActions,
    };
    const started = performance.now();
    let reason: ReturnType<typeof classifyFallback> = "unavailable_action";
    try {
      if (availableActions.length > 0) {
        const action = await this.transport(input);
        if (typeof action === "string" &&
          BEHAVIOR_ACTIONS.some((candidate) => candidate === action) &&
          availableActions.includes(action as BehaviorAction)) {
          this.trace?.record({
            provider: "jev", availableActions, selectedAction: action as BehaviorAction,
            latencyMs: performance.now() - started, fallbackReason: null, timestamp: Date.now(),
          });
          return action as BehaviorAction;
        }
      }
    } catch (error) {
      // Never log the transport error: it may contain request or credential details.
      reason = classifyFallback(error);
    }
    console.warn("Jev 决策不可用，已回退本地规则");
    const action = await this.fallback.decide(context, availableActions, sample);
    this.trace?.record({
      provider: "fallback", availableActions, selectedAction: action,
      latencyMs: performance.now() - started, fallbackReason: reason, timestamp: Date.now(),
    });
    return action;
  }
}
