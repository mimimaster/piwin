/**
 * Pure rules for iOS-style swipe-to-reveal rows. The component feeds pointer
 * deltas in; these decide which way the finger is going, how far the row
 * follows it, and whether it settles open or closed.
 */

/** Movement before a gesture commits to an axis; below this it is still a tap. */
export const SWIPE_AXIS_LOCK_PX = 8;
/** Past the fully open point the row follows at this fraction, like UIKit. */
const RUBBER_BAND = 0.25;
/** A flick this fast (px/ms) settles in its direction regardless of distance. */
const FLICK_VELOCITY = 0.4;

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical';

/** Commit to horizontal only when it clearly dominates, so scrolling stays native. */
export function lockSwipeAxis(dx: number, dy: number): SwipeAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < SWIPE_AXIS_LOCK_PX && ay < SWIPE_AXIS_LOCK_PX) return 'undecided';
  return ax > ay ? 'horizontal' : 'vertical';
}

/**
 * Where the row sits while dragging: 0 is closed, -revealWidth fully open.
 * Dragging right of closed does nothing; past fully open it rubber-bands.
 */
export function swipeDragOffset(startOffset: number, dx: number, revealWidth: number): number {
  const raw = startOffset + dx;
  if (raw > 0) return 0;
  if (raw < -revealWidth) return -revealWidth + (raw + revealWidth) * RUBBER_BAND;
  return raw;
}

/** Released: a flick wins, otherwise past halfway stays open. */
export function swipeSettlesOpen(offset: number, revealWidth: number, velocityX: number): boolean {
  if (velocityX <= -FLICK_VELOCITY) return true;
  if (velocityX >= FLICK_VELOCITY) return false;
  return offset < -revealWidth / 2;
}
