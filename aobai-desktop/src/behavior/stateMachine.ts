import type { PetState } from "../animation/catalog";
import type { ActivityMode } from "../settings/schema";

interface WeightedAction {
  readonly state: PetState;
  readonly weight: number;
}

const NORMAL_ACTIONS: readonly WeightedAction[] = [
  { state: "review", weight: 22 },
  { state: "waiting", weight: 22 },
  { state: "waving", weight: 20 },
  { state: "running", weight: 18 },
  { state: "failed", weight: 15 },
  { state: "jumping", weight: 3 },
];

const ACTIVE_ACTIONS: readonly WeightedAction[] = [
  { state: "waving", weight: 25 },
  { state: "review", weight: 22 },
  { state: "waiting", weight: 18 },
  { state: "running", weight: 20 },
  { state: "failed", weight: 5 },
  { state: "jumping", weight: 10 },
];

function pickWeighted(actions: readonly WeightedAction[], sample: number): PetState {
  const boundedSample = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999999) : 0;
  const total = actions.reduce((sum, action) => sum + action.weight, 0);
  let cursor = boundedSample * total;
  for (const action of actions) {
    cursor -= action.weight;
    if (cursor < 0) return action.state;
  }
  return actions[actions.length - 1]?.state ?? "idle";
}

export function selectAmbientAction(
  mode: ActivityMode,
  sample: number,
  previousState: PetState | null = null,
  availableActions?: readonly string[],
): PetState {
  if (mode === "quiet") return "idle";
  const weighted = mode === "active" ? ACTIVE_ACTIONS : NORMAL_ACTIONS;
  // A new motion pack must not randomly fall through to differently scaled
  // legacy artwork. Omitted availability preserves external v2 behavior.
  const actions = availableActions === undefined
    ? weighted
    : weighted.filter((action) => availableActions.includes(action.state))
      // Only the bundled pack maps "running" to kneading; legacy skins keep
      // their existing weights and semantics.
      .map((action) => action.state === "running" ? { ...action, weight: action.weight / 3 } : action);
  const alternatives = actions.filter((action) => action.state !== previousState);
  return pickWeighted(alternatives.length > 0 ? alternatives : actions, sample);
}

export function nextAmbientDelayMs(mode: ActivityMode, sample: number): number | null {
  if (mode === "quiet") return null;
  const boundedSample = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1) : 0;
  const [minimum, spread] = mode === "active" ? [15_000, 20_000] : [30_000, 40_000];
  return Math.round(minimum + spread * boundedSample);
}
