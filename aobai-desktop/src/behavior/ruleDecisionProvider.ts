import { selectAmbientAction } from "./stateMachine";
import { isPetState } from "../animation/catalog";
import {
  behaviorActionToMotionAction,
  motionActionToBehaviorAction,
  type BehaviorAction,
} from "./actions";
import type { BehaviorDecisionProvider } from "./decision";
import type { PetContext } from "./context";

const DAY_SLEEP_PROBABILITY = 0.04;
const NIGHT_SLEEP_PROBABILITY = 0.18;
const USER_INTERACTION_SUPPRESSION_SECONDS = 30;

function boundedSample(sample: number): number {
  return Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999999) : 0;
}

export class RuleDecisionProvider implements BehaviorDecisionProvider {
  decide(
    context: PetContext,
    availableActions: readonly BehaviorAction[],
    sample: number,
  ): BehaviorAction {
    const recent = context.recentActions[context.recentActions.length - 1];
    const previous = recent ?? context.previousAction;
    const canSleep = availableActions.includes("sleep");
    const night = context.hour >= 22 || context.hour < 6;
    const sleepProbability = context.mode === "normal" && canSleep &&
      previous !== "sleep" &&
      context.secondsSinceUserInteraction >= USER_INTERACTION_SUPPRESSION_SECONDS
      ? (night ? NIGHT_SLEEP_PROBABILITY : DAY_SLEEP_PROBABILITY)
      : 0;
    const sampleValue = boundedSample(sample);
    if (sampleValue < sleepProbability) return "sleep";

    // Feline Ethology: cats habitually stretch after waking up from sleep
    if (previous === "sleep" && availableActions.includes("stretch") && sampleValue < 0.6) {
      return "stretch";
    }

    const legacyActions = availableActions
      .map(behaviorActionToMotionAction)
      .filter(isPetState);
    const previousMotion = previous === null || previous === undefined
      ? null
      : behaviorActionToMotionAction(previous);
    const legacySample = sleepProbability === 0
      ? sampleValue
      : (sampleValue - sleepProbability) / (1 - sleepProbability);
    const selected = selectAmbientAction(
      context.mode,
      legacySample,
      previousMotion !== null && isPetState(previousMotion) ? previousMotion : null,
      legacyActions,
    );
    return motionActionToBehaviorAction(selected) ?? "idle";
  }
}
