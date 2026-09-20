import { ANIMATIONS, type PetState } from "./catalog";

export type MotionAction = PetState | "belly";
export interface MotionClip {
  readonly durations: readonly number[];
  readonly loop?: boolean;
  readonly heldLoop?: readonly [number, number];
  /** Inclusive body range and total passes; entry/recovery play once. */
  readonly repeat?: readonly [number, number, number];
}
export type MotionLibrary = Partial<Record<MotionAction, MotionClip>>;

export function legacyMotionLibrary(): MotionLibrary {
  return Object.fromEntries(Object.entries(ANIMATIONS).map(([name, clip]) =>
    [name, { durations: clip.frameDurationsMs, loop: clip.loop }]));
}

/** One visible clip and at most one intent. Position dragging is independent.
 * Clips include their own return-to-rest poses; never cross-fade whole cats.
 */
export class MotionPlayer {
  private action: MotionAction = "idle";
  private frame = 0;
  private pending: MotionAction | null = null;
  private held = false;
  private bodyPass = 1;

  constructor(private readonly clips: MotionLibrary) {
    if (!clips.idle?.durations.length) throw new Error("Missing idle motion");
  }

  get isHeld(): boolean { return this.held; }

  get snapshot() {
    const duration = this.clips[this.action]!.durations[this.frame]!;
    return { action: this.action, frame: this.frame,
      duration: this.pending !== null ? Math.min(duration, 120) : duration };
  }

  request(action: MotionAction): void {
    if (this.held || this.action === "belly" || !this.clips[action]) return;
    if (this.action === "idle") this.start(action);
    else this.pending = action;
  }

  press(): void {
    this.held = true;
    const action = this.clips.belly ? "belly" : this.clips.waiting ? "waiting" : "idle";
    if (this.action === action) {
      const loop = this.clips[action]?.heldLoop;
      if (loop && this.frame > loop[1]) this.pending = action;
      return;
    }
    if (this.action === "idle") this.start(action);
    else this.pending = action;
  }

  release(): void { this.held = false; }

  settle(): void {
    this.held = false;
    this.pending = this.action === "idle" ? null : "idle";
  }

  reset(): void {
    this.held = false;
    this.pending = null;
    this.start("idle");
  }

  advance(): void {
    const clip = this.clips[this.action]!;
    if (this.held && clip.heldLoop && this.frame === clip.heldLoop[1]) {
      this.frame = clip.heldLoop[0];
    } else if (clip.repeat && this.pending === null &&
        this.frame === clip.repeat[1] && this.bodyPass < clip.repeat[2]) {
      this.bodyPass++;
      this.frame = clip.repeat[0];
    } else if (this.frame + 1 < clip.durations.length) {
      this.frame++;
    } else {
      const next = this.pending ?? (clip.loop ? this.action : "idle");
      this.pending = null;
      this.start(next);
    }
  }

  private start(action: MotionAction): void {
    this.action = action;
    this.frame = 0;
    this.bodyPass = 1;
  }
}
