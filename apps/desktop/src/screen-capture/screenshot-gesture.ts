/**
 * What a press, drag and release mean on the capture editor (spec §12.6).
 *
 * Step 1 (no region): drag out a region; a plain click takes the whole screen.
 * Step 2 (region, no tool): drag inside to move it, drag a handle to resize,
 * drag outside to start over while nothing is drawn yet.
 * Step 2 (region + tool): draw inside the region.
 * Step 2, either way: a plain click on the dimmed area outside finishes
 * (owner, 2026-10-29), like clicking ✓.
 */
import {
  clampPointToImage,
  clampPointToRect,
  appendStrokePoint,
  rectFromPoints,
  type AnnotationShape,
  type AnnotationShapeDraft,
  type AnnotationTool,
  type ImagePoint,
  type ImageRect,
  type ImageSize,
} from './annotation-model.js';
import {
  HANDLE_CURSORS,
  hitTestSelection,
  moveSelection,
  normalizeSelection,
  resizeSelection,
  wholeImage,
  type SelectionHandle,
} from './selection-geometry.js';

type ShapeTool = 'rect' | 'ellipse' | 'arrow';
type StrokeTool = 'pen' | 'mosaic';

export type ScreenshotGesture =
  | { kind: 'select'; from: ImagePoint; to: ImagePoint }
  | { kind: 'move'; start: ImageRect; origin: ImagePoint; to: ImagePoint }
  | {
      kind: 'resize';
      start: ImageRect;
      handle: SelectionHandle;
      origin: ImagePoint;
      to: ImagePoint;
    }
  | { kind: 'shape'; tool: ShapeTool; from: ImagePoint; to: ImagePoint }
  | { kind: 'stroke'; tool: StrokeTool; points: readonly ImagePoint[] }
  /**
   * Press outside an existing region: a click finishes; a drag starts a new
   * region when `canReselect` (no tool, nothing drawn) and is ignored otherwise.
   */
  | {
      kind: 'outside';
      from: ImagePoint;
      to: ImagePoint;
      canReselect: boolean;
      /** Movement under this (image pixels) still counts as a click. */
      clickSlop: number;
    };

export type GestureContext = {
  image: ImageSize;
  selection: ImageRect | null;
  tool: AnnotationTool | null;
  /** Once something is drawn, a stray press outside must not drop the region. */
  hasMarks: boolean;
  /** Handle grab radius, in image pixels. */
  handleTolerance: number;
  /** Freehand sampling distance, in image pixels. */
  minStrokeDistance: number;
};

export type GestureStart =
  | { kind: 'gesture'; gesture: ScreenshotGesture }
  | { kind: 'text'; at: ImagePoint }
  | { kind: 'none' };

export type GestureEnd =
  | { kind: 'selection'; selection: ImageRect }
  | { kind: 'mark'; draft: AnnotationShapeDraft }
  | { kind: 'finish' }
  | { kind: 'none' };

export function beginGesture(context: GestureContext, rawPoint: ImagePoint): GestureStart {
  const point = clampPointToImage(rawPoint, context.image);
  const { selection, tool } = context;
  if (selection === null) {
    return { kind: 'gesture', gesture: { kind: 'select', from: point, to: point } };
  }
  if (tool === null) {
    const hit = hitTestSelection(selection, point, context.handleTolerance);
    if (hit.kind === 'handle') {
      return {
        kind: 'gesture',
        gesture: { kind: 'resize', start: selection, handle: hit.handle, origin: point, to: point },
      };
    }
    if (hit.kind === 'inside') {
      return {
        kind: 'gesture',
        gesture: { kind: 'move', start: selection, origin: point, to: point },
      };
    }
    return outsideGesture(point, !context.hasMarks, context);
  }
  if (!rectContains(selection, point)) {
    return outsideGesture(point, false, context);
  }
  switch (tool) {
    case 'text':
      return { kind: 'text', at: point };
    case 'pen':
    case 'mosaic':
      return { kind: 'gesture', gesture: { kind: 'stroke', tool, points: [point] } };
    case 'rect':
    case 'ellipse':
    case 'arrow':
      return { kind: 'gesture', gesture: { kind: 'shape', tool, from: point, to: point } };
  }
}

function outsideGesture(
  point: ImagePoint,
  canReselect: boolean,
  context: GestureContext,
): GestureStart {
  return {
    kind: 'gesture',
    gesture: {
      kind: 'outside',
      from: point,
      to: point,
      canReselect,
      clickSlop: context.handleTolerance / 2,
    },
  };
}

function outsideIsClick(gesture: Extract<ScreenshotGesture, { kind: 'outside' }>): boolean {
  return (
    Math.hypot(gesture.to.x - gesture.from.x, gesture.to.y - gesture.from.y) < gesture.clickSlop
  );
}

export function updateGesture(
  gesture: ScreenshotGesture,
  rawPoint: ImagePoint,
  context: GestureContext,
): ScreenshotGesture {
  const point = clampPointToImage(rawPoint, context.image);
  switch (gesture.kind) {
    case 'select':
    case 'move':
    case 'resize':
    case 'outside':
      return { ...gesture, to: point };
    case 'shape':
      return { ...gesture, to: insideSelection(point, context) };
    case 'stroke':
      return {
        ...gesture,
        points: appendStrokePoint(
          gesture.points,
          insideSelection(point, context),
          context.minStrokeDistance,
        ),
      };
  }
}

/** The region to draw while a gesture runs (the committed one otherwise). */
export function gestureSelection(
  gesture: ScreenshotGesture | null,
  selection: ImageRect | null,
  image: ImageSize,
): ImageRect | null {
  if (gesture === null) {
    return selection;
  }
  switch (gesture.kind) {
    case 'select':
      return rectFromPoints(gesture.from, gesture.to, image);
    case 'move':
      return moveSelection(gesture.start, delta(gesture.origin, gesture.to), image);
    case 'resize':
      return resizeSelection(gesture.start, gesture.handle, delta(gesture.origin, gesture.to), image);
    case 'outside':
      return gesture.canReselect && !outsideIsClick(gesture)
        ? rectFromPoints(gesture.from, gesture.to, image)
        : selection;
    case 'shape':
    case 'stroke':
      return selection;
  }
}

export function finishGesture(gesture: ScreenshotGesture, image: ImageSize): GestureEnd {
  switch (gesture.kind) {
    case 'select': {
      // A click (no real drag) takes the whole screen, like QQ over the desktop.
      const selection = normalizeSelection(rectFromPoints(gesture.from, gesture.to, image), image);
      return { kind: 'selection', selection: selection ?? wholeImage(image) };
    }
    case 'move':
    case 'resize': {
      const moved = normalizeSelection(gestureSelection(gesture, null, image) ?? gesture.start, image);
      return { kind: 'selection', selection: moved ?? gesture.start };
    }
    case 'outside': {
      if (outsideIsClick(gesture)) {
        return { kind: 'finish' };
      }
      if (!gesture.canReselect) {
        return { kind: 'none' };
      }
      const selection = normalizeSelection(rectFromPoints(gesture.from, gesture.to, image), image);
      return selection === null ? { kind: 'none' } : { kind: 'selection', selection };
    }
    case 'shape':
    case 'stroke': {
      const draft = gestureDraft(gesture, image);
      return draft === null ? { kind: 'none' } : { kind: 'mark', draft };
    }
  }
}

/** The mark being drawn, for live preview (`null` for region gestures). */
export function gestureDraft(
  gesture: ScreenshotGesture | null,
  image: ImageSize,
): AnnotationShapeDraft | null {
  if (gesture === null) {
    return null;
  }
  if (gesture.kind === 'shape') {
    if (gesture.tool === 'arrow') {
      return { kind: 'arrow', from: gesture.from, to: gesture.to };
    }
    return { kind: gesture.tool, rect: rectFromPoints(gesture.from, gesture.to, image) };
  }
  if (gesture.kind === 'stroke') {
    return { kind: gesture.tool, points: gesture.points };
  }
  return null;
}

/** A preview draft with a placeholder id, for the shared shape renderer. */
export function previewShape(draft: AnnotationShapeDraft | null): AnnotationShape | null {
  return draft === null ? null : { ...draft, id: 'draft' };
}

/** Pointer cursor while hovering (no button down), mirroring `beginGesture`. */
export function cursorForPoint(context: GestureContext, rawPoint: ImagePoint): string {
  const { selection, tool } = context;
  if (selection === null) {
    return 'crosshair';
  }
  const point = clampPointToImage(rawPoint, context.image);
  if (tool === null) {
    const hit = hitTestSelection(selection, point, context.handleTolerance);
    if (hit.kind === 'handle') return HANDLE_CURSORS[hit.handle];
    if (hit.kind === 'inside') return 'move';
    return context.hasMarks ? 'pointer' : 'crosshair';
  }
  if (!rectContains(selection, point)) {
    return 'pointer';
  }
  return tool === 'text' ? 'text' : 'crosshair';
}

export function selectionContains(selection: ImageRect | null, point: ImagePoint): boolean {
  return selection !== null && rectContains(selection, point);
}

function insideSelection(point: ImagePoint, context: GestureContext): ImagePoint {
  return context.selection === null ? point : clampPointToRect(point, context.selection);
}

function rectContains(rect: ImageRect, point: ImagePoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function delta(from: ImagePoint, to: ImagePoint): ImagePoint {
  return { x: to.x - from.x, y: to.y - from.y };
}
