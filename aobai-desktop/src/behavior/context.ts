import type { ActivityMode } from "../settings/schema";
import type { BehaviorAction } from "./actions";

export const MAX_RECENT_ACTIONS = 5;

export interface PetContext {
  readonly mode: ActivityMode;
  readonly currentAction: BehaviorAction;
  readonly previousAction: BehaviorAction | null;
  readonly recentActions: readonly BehaviorAction[];
  readonly secondsSinceLastAmbientAction: number;
  readonly secondsSinceUserInteraction: number;
  readonly hour: number;
}

export function appendRecentAction(
  recentActions: readonly BehaviorAction[],
  action: BehaviorAction,
  limit = MAX_RECENT_ACTIONS,
): readonly BehaviorAction[] {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (boundedLimit === 0) return [];
  return [...recentActions, action].slice(-boundedLimit);
}
