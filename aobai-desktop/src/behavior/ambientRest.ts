import type { ActivityMode } from "../settings/schema";
import { nextAmbientDelayMs } from "./stateMachine";

/** A full quiet interval starts on return to rest, never during an action.
 * The host supplies monotonic time and clears eligibility while hidden/held.
 */
export class AmbientRest {
  private mode: ActivityMode | null = null;
  private dueAt: number | null = null;

  poll(mode: ActivityMode, resting: boolean, now: number, sample: () => number): boolean {
    if (!resting || mode === "quiet") {
      this.mode = mode;
      this.dueAt = null;
      return false;
    }
    if (this.mode !== mode || this.dueAt === null) {
      this.mode = mode;
      this.dueAt = now + nextAmbientDelayMs(mode, sample())!;
      return false;
    }
    if (now < this.dueAt) return false;
    // An idle decision or failed request also gets a fresh quiet interval.
    this.dueAt = now + nextAmbientDelayMs(mode, sample())!;
    return true;
  }
}
