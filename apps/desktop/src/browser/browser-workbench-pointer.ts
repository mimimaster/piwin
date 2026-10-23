/**
 * Map panel display coordinates to CSS viewport px (ADR 0057).
 * `viewportWidth`/`viewportHeight` come from `browser/frame` — never img.naturalWidth.
 * Frames use object-fit: contain; letterbox clicks must not dispatch.
 */
import type { BrowserInputEvent } from '@piwin/contracts';

export type DisplayRect = { x: number; y: number; width: number; height: number };

/**
 * Displayed image content box inside an `object-fit: contain` element.
 * `intrinsicWidth`/`intrinsicHeight` are the CSS viewport, not encoded JPEG px.
 */
export function contentRectFromImage(input: {
  elementWidth: number;
  elementHeight: number;
  intrinsicWidth: number;
  intrinsicHeight: number;
}): DisplayRect | null {
  if (
    !Number.isFinite(input.elementWidth) ||
    !Number.isFinite(input.elementHeight) ||
    !Number.isFinite(input.intrinsicWidth) ||
    !Number.isFinite(input.intrinsicHeight) ||
    input.elementWidth <= 0 ||
    input.elementHeight <= 0 ||
    input.intrinsicWidth <= 0 ||
    input.intrinsicHeight <= 0
  ) {
    return null;
  }
  const scale = Math.min(
    input.elementWidth / input.intrinsicWidth,
    input.elementHeight / input.intrinsicHeight,
  );
  const width = input.intrinsicWidth * scale;
  const height = input.intrinsicHeight * scale;
  return {
    x: (input.elementWidth - width) / 2,
    y: (input.elementHeight - height) / 2,
    width,
    height,
  };
}

export function viewportFromDisplay(input: {
  displayX: number;
  displayY: number;
  displayWidth: number;
  displayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { x: number; y: number } | null {
  const content = contentRectFromImage({
    elementWidth: input.displayWidth,
    elementHeight: input.displayHeight,
    intrinsicWidth: input.viewportWidth,
    intrinsicHeight: input.viewportHeight,
  });
  if (!content) return null;
  const localX = input.displayX - content.x;
  const localY = input.displayY - content.y;
  if (localX < 0 || localY < 0 || localX > content.width || localY > content.height) {
    return null;
  }
  return {
    x: Math.round((localX / content.width) * input.viewportWidth),
    y: Math.round((localY / content.height) * input.viewportHeight),
  };
}

/** Map a CSS viewport rect onto the displayed contain-box (pick highlight). */
export function displayRectFromViewport(input: {
  viewportX: number;
  viewportY: number;
  viewportBoxWidth: number;
  viewportBoxHeight: number;
  displayWidth: number;
  displayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): DisplayRect | null {
  const content = contentRectFromImage({
    elementWidth: input.displayWidth,
    elementHeight: input.displayHeight,
    intrinsicWidth: input.viewportWidth,
    intrinsicHeight: input.viewportHeight,
  });
  if (!content) return null;
  const scaleX = content.width / input.viewportWidth;
  const scaleY = content.height / input.viewportHeight;
  return {
    x: content.x + input.viewportX * scaleX,
    y: content.y + input.viewportY * scaleY,
    width: input.viewportBoxWidth * scaleX,
    height: input.viewportBoxHeight * scaleY,
  };
}

/**
 * Map a click on a filled display box (object-fit:fill, same aspect as the CSS
 * viewport) into CSS viewport px. Letterboxing is a container concern — the
 * image element itself is the page.
 */
export function viewportFromFilledDisplay(input: {
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
  if (
    input.displayX < 0 ||
    input.displayY < 0 ||
    input.displayX > input.displayWidth ||
    input.displayY > input.displayHeight
  ) {
    return null;
  }
  return {
    x: Math.round((input.displayX / input.displayWidth) * input.viewportWidth),
    y: Math.round((input.displayY / input.displayHeight) * input.viewportHeight),
  };
}

/** Inverse of `viewportFromFilledDisplay` for the pick highlight. */
export function displayRectFromFilledViewport(input: {
  viewportX: number;
  viewportY: number;
  viewportBoxWidth: number;
  viewportBoxHeight: number;
  displayWidth: number;
  displayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): DisplayRect | null {
  if (input.viewportWidth <= 0 || input.viewportHeight <= 0) return null;
  const scaleX = input.displayWidth / input.viewportWidth;
  const scaleY = input.displayHeight / input.viewportHeight;
  return {
    x: input.viewportX * scaleX,
    y: input.viewportY * scaleY,
    width: input.viewportBoxWidth * scaleX,
    height: input.viewportBoxHeight * scaleY,
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
