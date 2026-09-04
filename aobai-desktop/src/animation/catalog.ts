export const PET_STATES = [
  "idle",
  "running",
  "running-left",
  "running-right",
  "waiting",
  "waving",
  "jumping",
  "review",
  "failed",
] as const;

export type PetState = (typeof PET_STATES)[number];

export interface AnimationDefinition {
  readonly state: PetState;
  readonly row: number;
  readonly frameCount: number;
  readonly frameDurationsMs: readonly number[];
  readonly loop: boolean;
}

function animation(
  state: PetState,
  row: number,
  frameDurationsMs: readonly number[],
  loop: boolean,
): AnimationDefinition {
  return {
    state,
    row,
    frameCount: frameDurationsMs.length,
    frameDurationsMs,
    loop,
  };
}

export const ANIMATIONS: Readonly<Record<PetState, AnimationDefinition>> = {
  // Rest dominates the cycle; the blink must not repeat every second.
  idle: animation("idle", 0, [2_800, 900, 140, 900, 1_200, 2_000], true),
  "running-right": animation("running-right", 1, [120, 120, 120, 120, 120, 120, 120, 220], false),
  "running-left": animation("running-left", 2, [120, 120, 120, 120, 120, 120, 120, 220], false),
  waving: animation("waving", 3, [500, 650, 1_600, 600], false),
  jumping: animation("jumping", 4, [140, 140, 140, 140, 280], false),
  // Codex state names remain stable; AllBuy depicts loafing and kneading here.
  failed: animation("failed", 5, [700, 900, 1_200, 3_000, 4_000, 3_000, 900, 700], false),
  waiting: animation("waiting", 6, [650, 650, 900, 650, 900, 650], false),
  running: animation("running", 7, [600, 600, 600, 600, 600, 800], false),
  review: animation("review", 8, [600, 700, 900, 1_100, 700, 600], false),
};

export function isPetState(value: unknown): value is PetState {
  return typeof value === "string" && PET_STATES.includes(value as PetState);
}
