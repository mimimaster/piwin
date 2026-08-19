/**
 * Map panel display coordinates to CSS viewport px (ADR 0057).
 * `viewportWidth`/`viewportHeight` come from `browser/frame` — never img.naturalWidth.
 */
import type { BrowserInputEvent } from '@piwin/contracts';

export function viewportFromDisplay(input: {
  displayX: number;
  displayY: number;
  displayWidth: number;
  displayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { x: number; y: number } {
  if (input.displayWidth <= 0 || input.displayHeight <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.round((input.displayX / input.displayWidth) * input.viewportWidth),
    y: Math.round((input.displayY / input.displayHeight) * input.viewportHeight),
  };
}

/** Collapse consecutive mouse-move events, preserving order of everything else. */
export function coalesceMouseMoves(events: BrowserInputEvent[]): BrowserInputEvent[] {
  const coalesced: BrowserInputEvent[] = [];
  for (const event of events) {
    const previous = coalesced[coalesced.length - 1];
    if (
      event.type === 'mouse' &&
      event.action === 'move' &&
      previous?.type === 'mouse' &&
      previous.action === 'move'
    ) {
      coalesced[coalesced.length - 1] = event;
      continue;
    }
    coalesced.push(event);
  }
  return coalesced;
}
