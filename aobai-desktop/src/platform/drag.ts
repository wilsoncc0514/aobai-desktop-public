export interface Point {
  readonly x: number;
  readonly y: number;
}

export function shouldUseManualWindowDrag(userAgent: string): boolean {
  // Native macOS dragging takes over the event loop and hides pointer lifecycle
  // from the animator. Keep directional poses tied to captured pointer events.
  return /Windows|Macintosh|Mac OS X/i.test(userAgent);
}

export function draggedWindowPosition(
  origin: Point,
  pointerStart: Point,
  pointerCurrent: Point,
  scaleFactor: number,
): Point {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round(origin.x + (pointerCurrent.x - pointerStart.x) * scale),
    y: Math.round(origin.y + (pointerCurrent.y - pointerStart.y) * scale),
  };
}
