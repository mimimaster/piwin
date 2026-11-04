/**
 * Mini frame uses object-fit:cover / object-position:top center.
 * Map a click on that box into CSS viewport px without resizing the page.
 */
export function viewportFromCoverTopDisplay(input: {
  displayX: number;
  displayY: number;
  displayWidth: number;
  displayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { x: number; y: number } | null {
  if (
    input.displayWidth <= 0 ||
    input.displayHeight <= 0 ||
    input.viewportWidth <= 0 ||
    input.viewportHeight <= 0
  ) {
    return null;
  }
  const scale = Math.max(
    input.displayWidth / input.viewportWidth,
    input.displayHeight / input.viewportHeight,
  );
  const originX = (input.displayWidth - input.viewportWidth * scale) / 2;
  const originY = 0;
  const x = (input.displayX - originX) / scale;
  const y = (input.displayY - originY) / scale;
  if (x < 0 || y < 0 || x > input.viewportWidth || y > input.viewportHeight) {
    return null;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

export function wheelDeltaFromCoverDisplay(input: {
  deltaX: number;
  deltaY: number;
  displayWidth: number;
  displayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { deltaX: number; deltaY: number } | null {
  if (
    input.displayWidth <= 0 ||
    input.displayHeight <= 0 ||
    input.viewportWidth <= 0 ||
    input.viewportHeight <= 0
  ) {
    return null;
  }
  const scale = Math.max(
    input.displayWidth / input.viewportWidth,
    input.displayHeight / input.viewportHeight,
  );
  return {
    deltaX: Math.round(input.deltaX / scale),
    deltaY: Math.round(input.deltaY / scale),
  };
}
