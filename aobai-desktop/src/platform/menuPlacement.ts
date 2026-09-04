export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const MENU_ESTIMATED_WIDTH = 220;
const MENU_GAP = 10;

/**
 * Returns a physical x offset relative to the pet window. The preferred side
 * is chosen from the monitor work area so the native menu does not cover the pet.
 */
export function contextMenuXOffset(
  windowBounds: Rectangle,
  monitorBounds: Rectangle,
  scaleFactor = 1,
): number {
  const menuWidth = MENU_ESTIMATED_WIDTH * scaleFactor;
  const gap = MENU_GAP * scaleFactor;
  const rightEdge = monitorBounds.x + monitorBounds.width;
  const rightSpace = rightEdge - (windowBounds.x + windowBounds.width);
  if (rightSpace >= menuWidth + gap) {
    return windowBounds.width + gap;
  }
  return -(menuWidth + gap);
}
