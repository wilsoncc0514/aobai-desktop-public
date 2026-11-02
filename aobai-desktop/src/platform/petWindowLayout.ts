export const PET_HEIGHT = 208;
export const BUBBLE_HEIGHT = 64;
export interface PetWindowAdapter {
  position(): Promise<{ x: number; y: number }>;
  height(): Promise<number>;
  scale(): Promise<number>;
  resize(height: number): Promise<void>;
  move(position: { x: number; y: number }): Promise<void>;
}

// Stored coordinates retain the previous 272px-window origin for compatibility.
export class PetWindowLayout {
  private desired = true;
  private suspended = false;
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly window: PetWindowAdapter) {}

  request(expanded: boolean): Promise<void> {
    this.desired = expanded;
    return this.enqueue();
  }
  suspend(value: boolean): Promise<void> {
    this.suspended = value;
    return value ? this.chain : this.enqueue();
  }
  private enqueue(): Promise<void> {
    const update = this.chain.then(async () => {
      if (this.suspended) return;
      const expanded = this.desired;
      const scale = await this.window.scale();
      const oldHeight = await this.window.height();
      const targetHeight = Math.round((PET_HEIGHT + (expanded ? BUBBLE_HEIGHT : 0)) * scale);
      if (Math.abs(oldHeight - targetHeight) <= 1 || this.suspended) return;
      const oldPosition = await this.window.position();
      if (this.suspended) return;
      await this.window.resize(expanded ? PET_HEIGHT + BUBBLE_HEIGHT : PET_HEIGHT);
      const newHeight = await this.window.height();
      try {
        await this.window.move({ x: oldPosition.x, y: oldPosition.y + oldHeight - newHeight });
      } catch (error) {
        // Restore the old size when repositioning fails, so the body does not move.
        await this.window.resize(oldHeight / scale).catch(() => undefined);
        throw error;
      }
    });
    this.chain = update.catch(() => undefined);
    return update;
  }
  async storedPosition(): Promise<{ x: number; y: number }> {
    await this.chain;
    const [position, height, scale] = await Promise.all([
      this.window.position(), this.window.height(), this.window.scale(),
    ]);
    return { x: position.x, y: Math.round(position.y - (Math.round((PET_HEIGHT + BUBBLE_HEIGHT) * scale) - height)) };
  }
}
