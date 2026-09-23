/** Keeps one ambient request in flight and rejects results invalidated by interaction. */
export class AmbientDecisionGate {
  private generation = 0;
  private pending: number | null = null;

  begin(): number | null {
    if (this.pending !== null) return null;
    this.pending = ++this.generation;
    return this.pending;
  }

  invalidate(): void {
    this.generation++;
  }

  isCurrent(generation: number): boolean {
    return this.pending === generation && generation === this.generation;
  }

  finish(generation: number): boolean {
    if (this.pending !== generation) return false;
    this.pending = null;
    return generation === this.generation;
  }
}
