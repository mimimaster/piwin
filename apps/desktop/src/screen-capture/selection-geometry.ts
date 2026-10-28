/**
 * Region selection on the capture overlay (spec §12.6): hit testing the
 * eight handles, moving and resizing inside the image, and where the
 * toolbar goes. Pure, image-pixel geometry; the view converts once.
 */
import {
  clamp,
  clampRectToImage,
  MIN_SHAPE_SIZE_PX,
  type ImagePoint,
  type ImageRect,
  type ImageSize,
} from './annotation-model.js';

export type SelectionHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type SelectionHit =
  | { kind: 'handle'; handle: SelectionHandle }
  | { kind: 'inside' }
  | { kind: 'outside' };

export const SELECTION_HANDLES: readonly SelectionHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

export const HANDLE_CURSORS: Record<SelectionHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/** Center of a handle on the selection border. */
export function handlePoint(selection: ImageRect, handle: SelectionHandle): ImagePoint {
  const left = selection.x;
  const right = selection.x + selection.width;
  const top = selection.y;
  const bottom = selection.y + selection.height;
  const middleX = left + selection.width / 2;
  const middleY = top + selection.height / 2;
  const x = handle.includes('w') ? left : handle.includes('e') ? right : middleX;
  const y = handle.includes('n') ? top : handle.includes('s') ? bottom : middleY;
  return { x, y };
}

/** `tolerance` is the grab radius around a handle, in image pixels. */
export function hitTestSelection(
  selection: ImageRect,
  point: ImagePoint,
  tolerance: number,
): SelectionHit {
  for (const handle of SELECTION_HANDLES) {
    const center = handlePoint(selection, handle);
    if (Math.abs(point.x - center.x) <= tolerance && Math.abs(point.y - center.y) <= tolerance) {
      return { kind: 'handle', handle };
    }
  }
  const inside =
    point.x >= selection.x &&
    point.x <= selection.x + selection.width &&
    point.y >= selection.y &&
    point.y <= selection.y + selection.height;
  return inside ? { kind: 'inside' } : { kind: 'outside' };
}

/**
 * Drag one handle by `delta`. Dragging past the opposite edge flips the
 * rect instead of collapsing it, the same as every native picker.
 */
export function resizeSelection(
  start: ImageRect,
  handle: SelectionHandle,
  delta: ImagePoint,
  image: ImageSize,
): ImageRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left += delta.x;
  if (handle.includes('e')) right += delta.x;
  if (handle.includes('n')) top += delta.y;
  if (handle.includes('s')) bottom += delta.y;
  return clampRectToImage({ x: left, y: top, width: right - left, height: bottom - top }, image);
}

/** Move by `delta`, keeping the size and staying inside the image. */
export function moveSelection(start: ImageRect, delta: ImagePoint, image: ImageSize): ImageRect {
  return {
    x: clamp(start.x + delta.x, 0, Math.max(0, image.width - start.width)),
    y: clamp(start.y + delta.y, 0, Math.max(0, image.height - start.height)),
    width: start.width,
    height: start.height,
  };
}

/**
 * Whole pixels (canvas export needs integers), inside the image. A region
 * too small to be intentional is `null`; the caller decides what a click means.
 */
export function normalizeSelection(rect: ImageRect, image: ImageSize): ImageRect | null {
  const clamped = clampRectToImage(rect, image);
  const x = Math.round(clamped.x);
  const y = Math.round(clamped.y);
  const width = Math.round(clamped.x + clamped.width) - x;
  const height = Math.round(clamped.y + clamped.height) - y;
  if (width < MIN_SHAPE_SIZE_PX || height < MIN_SHAPE_SIZE_PX) {
    return null;
  }
  return { x, y, width, height };
}

export function wholeImage(image: ImageSize): ImageRect {
  return { x: 0, y: 0, width: image.width, height: image.height };
}

export type ViewBox = { left: number; top: number; width: number; height: number };

/**
 * QQ placement: under the selection, right edges aligned; above it when
 * there is no room below; inside its bottom-right corner when it fills the
 * screen. Always kept on screen. Everything here is in view pixels.
 */
export function placeToolbar(
  selection: ViewBox,
  toolbar: { width: number; height: number },
  viewport: { width: number; height: number },
  gap: number,
): { left: number; top: number } {
  const below = selection.top + selection.height + gap;
  const above = selection.top - gap - toolbar.height;
  let top: number;
  if (below + toolbar.height <= viewport.height - gap) {
    top = below;
  } else if (above >= gap) {
    top = above;
  } else {
    top = selection.top + selection.height - gap - toolbar.height;
  }
  const preferredLeft = selection.left + selection.width - toolbar.width;
  const maxLeft = Math.max(gap, viewport.width - gap - toolbar.width);
  return {
    left: clamp(preferredLeft, gap, maxLeft),
    top: clamp(top, gap, Math.max(gap, viewport.height - gap - toolbar.height)),
  };
}

/** The size badge sits above the top-left corner, or just inside it. */
export function placeSizeBadge(
  selection: ViewBox,
  badgeHeight: number,
  gap: number,
): { left: number; top: number } {
  const above = selection.top - gap - badgeHeight;
  return { left: selection.left, top: above >= 0 ? above : selection.top + gap };
}
