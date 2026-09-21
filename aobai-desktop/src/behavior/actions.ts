import type { MotionAction } from "../animation/motion";

export const BEHAVIOR_ACTIONS = [
  "idle",
  "groom",
  "knead",
  "stretch",
  "sleep",
] as const;

export type BehaviorAction = (typeof BEHAVIOR_ACTIONS)[number];

const MOTION_BY_BEHAVIOR: Readonly<Record<BehaviorAction, MotionAction>> = {
  idle: "idle",
  groom: "waving",
  knead: "running",
  stretch: "review",
  sleep: "sleep",
};

export function behaviorActionToMotionAction(action: BehaviorAction): MotionAction {
  return MOTION_BY_BEHAVIOR[action];
}

export function motionActionToBehaviorAction(action: string): BehaviorAction | null {
  return BEHAVIOR_ACTIONS.find(
    (behavior) => MOTION_BY_BEHAVIOR[behavior] === action,
  ) ?? null;
}

export function availableBehaviorActionsForMotions(
  motions: readonly string[],
): readonly BehaviorAction[] {
  const available = new Set(motions);
  return BEHAVIOR_ACTIONS.filter(
    (behavior) => available.has(MOTION_BY_BEHAVIOR[behavior]),
  );
}
