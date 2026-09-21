export const MIN_SLEEP_ROUNDS = 2;
export const MAX_SLEEP_ROUNDS = 6;

export interface MotionPosition {
  readonly action: string;
  readonly frame: number;
}

export interface SleepSessionSnapshot {
  readonly active: boolean;
  readonly phase: "inactive" | "entering" | "sleeping" | "exiting";
  readonly totalRounds: number;
  readonly completedRounds: number;
}

export type SleepSessionCommand = "sleep" | "sleep-exit" | "complete" | null;

function boundedSample(sample: number): number {
  return Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999999) : 0;
}

/** Tracks one in-memory sleep behavior. MotionPlayer remains the frame owner. */
export class SleepSession {
  private totalRounds = 0;
  private completedRounds = 0;
  private phase: SleepSessionSnapshot["phase"] = "inactive";
  private withTransitions = false;

  get snapshot(): SleepSessionSnapshot {
    return {
      active: this.totalRounds > 0,
      phase: this.phase,
      totalRounds: this.totalRounds,
      completedRounds: this.completedRounds,
    };
  }

  start(sample: number, withTransitions = false): number {
    this.totalRounds = MIN_SLEEP_ROUNDS + Math.floor(
      boundedSample(sample) * (MAX_SLEEP_ROUNDS - MIN_SLEEP_ROUNDS + 1),
    );
    this.completedRounds = 0;
    this.withTransitions = withTransitions;
    this.phase = withTransitions ? "entering" : "sleeping";
    return this.totalRounds;
  }

  cancel(): boolean {
    const wasActive = this.totalRounds > 0;
    this.totalRounds = 0;
    this.completedRounds = 0;
    this.withTransitions = false;
    this.phase = "inactive";
    return wasActive;
  }

  /** Returns the immediate clip handoff required after an animation advance. */
  observeAdvance(before: MotionPosition, after: MotionPosition): SleepSessionCommand {
    if (this.totalRounds === 0) return null;
    if (this.phase === "entering") {
      if (before.action === "sleep-enter" && after.action === "sleep-enter") return null;
      if (before.action === "sleep-enter" && after.action === "idle") {
        this.phase = "sleeping";
        return "sleep";
      }
      this.cancel();
      return null;
    }
    if (this.phase === "exiting") {
      if (before.action === "sleep-exit" && after.action === "sleep-exit") return null;
      if (before.action === "sleep-exit" && after.action === "idle") {
        this.cancel();
        return "complete";
      }
      this.cancel();
      return null;
    }
    if (before.action !== "sleep" || after.action !== "sleep") {
      this.cancel();
      return null;
    }
    if (before.frame <= after.frame || after.frame !== 0) return null;
    this.completedRounds++;
    if (this.completedRounds < this.totalRounds) return null;
    if (!this.withTransitions) {
      this.cancel();
      return "complete";
    }
    this.phase = "exiting";
    return "sleep-exit";
  }
}
