interface Rectangle {
  readonly position: { readonly x: number; readonly y: number };
  readonly size: { readonly width: number; readonly height: number };
}

/** Require at least half of each window dimension on one monitor. */
export function hasReachableArea(
  position: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  monitors: readonly Rectangle[],
): boolean {
  if (size.width <= 0 || size.height <= 0) return false;
  return monitors.some((monitor) => {
    const overlapWidth = Math.min(position.x + size.width, monitor.position.x + monitor.size.width)
      - Math.max(position.x, monitor.position.x);
    const overlapHeight = Math.min(position.y + size.height, monitor.position.y + monitor.size.height)
      - Math.max(position.y, monitor.position.y);
    return overlapWidth >= size.width / 2 && overlapHeight >= size.height / 2;
  });
}
