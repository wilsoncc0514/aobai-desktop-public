import type { AnimationDefinition } from "./catalog";

export interface FrameAdvance {
  readonly frameIndex: number;
  readonly completed: boolean;
}

export function advanceFrame(
  animation: AnimationDefinition,
  frameIndex: number,
): FrameAdvance {
  const lastFrame = animation.frameCount - 1;
  if (frameIndex < 0 || frameIndex > lastFrame) {
    return { frameIndex: 0, completed: false };
  }
  if (frameIndex < lastFrame) {
    return { frameIndex: frameIndex + 1, completed: false };
  }
  if (animation.loop) {
    return { frameIndex: 0, completed: false };
  }
  return { frameIndex: lastFrame, completed: true };
}
