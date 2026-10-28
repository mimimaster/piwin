/**
 * Screenshot annotation model (spec 2026-10-25 §6, QQ-style revision §12.6).
 *
 * Every coordinate is in image pixels, so export does not depend on window
 * size or display scale. The view only maps through a `ViewTransform`. The
 * selected region is editor state, not history: like QQ, undo removes marks.
 */

export type ImagePoint = { x: number; y: number };

export type ImageRect = { x: number; y: number; width: number; height: number };

export type ImageSize = { width: number; height: number };

export type AnnotationTool = 'rect' | 'ellipse' | 'arrow' | 'pen' | 'mosaic' | 'text';

export type AnnotationShape =
  | { kind: 'rect'; id: string; rect: ImageRect }
  | { kind: 'ellipse'; id: string; rect: ImageRect }
  | { kind: 'arrow'; id: string; from: ImagePoint; to: ImagePoint }
  | { kind: 'pen'; id: string; points: readonly ImagePoint[] }
  | { kind: 'mosaic'; id: string; points: readonly ImagePoint[] }
  | { kind: 'text'; id: string; at: ImagePoint; text: string };

/** Distributes over the union so each variant keeps its own fields. */
type WithoutId<Shape> = Shape extends unknown ? Omit<Shape, 'id'> : never;

/** A shape before the model assigns its id. */
export type AnnotationShapeDraft = WithoutId<AnnotationShape>;

export type AnnotationDocument = {
  image: ImageSize;
  shapes: readonly AnnotationShape[];
};

export type AnnotationHistory = {
  past: readonly AnnotationDocument[];
  present: AnnotationDocument;
  future: readonly AnnotationDocument[];
};

export type AnnotationStyle = {
  color: string;
  strokeWidth: number;
  fontSize: number;
  textHaloWidth: number;
  arrowHeadLength: number;
  /** Width of the mosaic brush, in image pixels. */
  mosaicBrushWidth: number;
  /** Edge of one mosaic block, in image pixels. */
  mosaicBlockSize: number;
};

/** Maps image pixels to view pixels: `view = image * scale + offset`. */
export type ViewTransform = { scale: number; offsetX: number; offsetY: number };

export const ANNOTATION_COLOR = '#E5322D';
/** Smaller drags are treated as accidental clicks and dropped. */
export const MIN_SHAPE_SIZE_PX = 4;
const ARROW_HEAD_HALF_ANGLE_RAD = (28 * Math.PI) / 180;

export function createAnnotationHistory(image: ImageSize): AnnotationHistory {
  return { past: [], present: { image, shapes: [] }, future: [] };
}

export function canUndoAnnotation(history: AnnotationHistory): boolean {
  return history.past.length > 0;
}

export function canRedoAnnotation(history: AnnotationHistory): boolean {
  return history.future.length > 0;
}

export function undoAnnotation(history: AnnotationHistory): AnnotationHistory {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) {
    return history;
  }
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoAnnotation(history: AnnotationHistory): AnnotationHistory {
  const next = history.future[0];
  if (next === undefined) {
    return history;
  }
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

/**
 * Add one mark. A degenerate mark (tiny drag, empty text) returns the same
 * history so it never becomes an undo step.
 */
export function addAnnotationShape(
  history: AnnotationHistory,
  draft: AnnotationShapeDraft,
): AnnotationHistory {
  const document = history.present;
  const shape = finalizeShape(draft, document);
  if (shape === null) {
    return history;
  }
  return {
    past: [...history.past, document],
    present: { ...document, shapes: [...document.shapes, shape] },
    future: [],
  };
}

function finalizeShape(
  draft: AnnotationShapeDraft,
  document: AnnotationDocument,
): AnnotationShape | null {
  const id = `${draft.kind}-${document.shapes.length + 1}`;
  const { image } = document;
  switch (draft.kind) {
    case 'rect':
    case 'ellipse': {
      const rect = clampRectToImage(draft.rect, image);
      if (rect.width < MIN_SHAPE_SIZE_PX || rect.height < MIN_SHAPE_SIZE_PX) {
        return null;
      }
      return { kind: draft.kind, id, rect };
    }
    case 'arrow': {
      const from = clampPointToImage(draft.from, image);
      const to = clampPointToImage(draft.to, image);
      if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_SHAPE_SIZE_PX) {
        return null;
      }
      return { kind: 'arrow', id, from, to };
    }
    case 'pen': {
      const points = draft.points.map((point) => clampPointToImage(point, image));
      if (strokeLength(points) < MIN_SHAPE_SIZE_PX) {
        return null;
      }
      return { kind: 'pen', id, points };
    }
    case 'mosaic': {
      // A single dab is a valid mosaic: one click hides a short word.
      const points = draft.points.map((point) => clampPointToImage(point, image));
      return points.length === 0 ? null : { kind: 'mosaic', id, points };
    }
    case 'text': {
      const text = draft.text.replace(/\s+/g, ' ').trim();
      if (text.length === 0) {
        return null;
      }
      return { kind: 'text', id, at: clampPointToImage(draft.at, image), text };
    }
  }
}

/**
 * Append a freehand sample unless it is closer than `minDistance` to the
 * last one; pointer events fire far more often than a stroke needs.
 */
export function appendStrokePoint(
  points: readonly ImagePoint[],
  point: ImagePoint,
  minDistance: number,
): readonly ImagePoint[] {
  const last = points[points.length - 1];
  if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) < minDistance) {
    return points;
  }
  return [...points, point];
}

function strokeLength(points: readonly ImagePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous !== undefined && current !== undefined) {
      length += Math.hypot(current.x - previous.x, current.y - previous.y);
    }
  }
  return length;
}

/** Rect spanned by two drag points, in either direction, clamped to the image. */
export function rectFromPoints(from: ImagePoint, to: ImagePoint, image: ImageSize): ImageRect {
  return clampRectToImage(
    { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y },
    image,
  );
}

/** Flip negative width/height, then clamp inside the image. */
export function clampRectToImage(rect: ImageRect, image: ImageSize): ImageRect {
  const left = clamp(Math.min(rect.x, rect.x + rect.width), 0, image.width);
  const right = clamp(Math.max(rect.x, rect.x + rect.width), 0, image.width);
  const top = clamp(Math.min(rect.y, rect.y + rect.height), 0, image.height);
  const bottom = clamp(Math.max(rect.y, rect.y + rect.height), 0, image.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function clampPointToImage(point: ImagePoint, image: ImageSize): ImagePoint {
  return { x: clamp(point.x, 0, image.width), y: clamp(point.y, 0, image.height) };
}

export function clampPointToRect(point: ImagePoint, rect: ImageRect): ImagePoint {
  return {
    x: clamp(point.x, rect.x, rect.x + rect.width),
    y: clamp(point.y, rect.y, rect.y + rect.height),
  };
}

/** Sizes scale with the image's long edge so Retina and 1x captures look alike. */
export function annotationStyle(image: ImageSize): AnnotationStyle {
  const longEdge = Math.max(image.width, image.height);
  const strokeWidth = Math.max(3, Math.round(longEdge / 400));
  const fontSize = Math.max(16, Math.round(longEdge / 60));
  return {
    color: ANNOTATION_COLOR,
    strokeWidth,
    fontSize,
    textHaloWidth: fontSize / 8,
    arrowHeadLength: strokeWidth * 4,
    mosaicBrushWidth: Math.max(16, Math.round(longEdge / 60)),
    mosaicBlockSize: Math.max(8, Math.round(longEdge / 160)),
  };
}

/**
 * Arrow head as `[left, tip, right]`, plus the point where the shaft should
 * stop so a thick line does not poke through the head's tip.
 */
export function arrowGeometry(
  from: ImagePoint,
  to: ImagePoint,
  headLength: number,
): { head: [ImagePoint, ImagePoint, ImagePoint]; shaftEnd: ImagePoint } {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const effectiveHead = Math.min(headLength, length);
  const left = {
    x: to.x - effectiveHead * Math.cos(angle - ARROW_HEAD_HALF_ANGLE_RAD),
    y: to.y - effectiveHead * Math.sin(angle - ARROW_HEAD_HALF_ANGLE_RAD),
  };
  const right = {
    x: to.x - effectiveHead * Math.cos(angle + ARROW_HEAD_HALF_ANGLE_RAD),
    y: to.y - effectiveHead * Math.sin(angle + ARROW_HEAD_HALF_ANGLE_RAD),
  };
  const shaftBack = effectiveHead * Math.cos(ARROW_HEAD_HALF_ANGLE_RAD);
  const shaftEnd = {
    x: to.x - shaftBack * Math.cos(angle),
    y: to.y - shaftBack * Math.sin(angle),
  };
  return { head: [left, { ...to }, right], shaftEnd };
}

/** SVG path for a freehand stroke; one point becomes a zero-length dot. */
export function strokePath(points: readonly ImagePoint[]): string {
  const [first, ...rest] = points;
  if (first === undefined) {
    return '';
  }
  const tail = rest.length === 0 ? [first] : rest;
  return `M${first.x} ${first.y}${tail.map((point) => `L${point.x} ${point.y}`).join('')}`;
}

/** Fit the image inside the view, centered, never enlarged past 1:1. */
export function fitViewTransform(image: ImageSize, view: ImageSize): ViewTransform {
  if (image.width <= 0 || image.height <= 0 || view.width <= 0 || view.height <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(view.width / image.width, view.height / image.height, 1);
  return {
    scale,
    offsetX: (view.width - image.width * scale) / 2,
    offsetY: (view.height - image.height * scale) / 2,
  };
}

export function viewToImagePoint(point: ImagePoint, transform: ViewTransform): ImagePoint {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  };
}

export function imageToViewPoint(point: ImagePoint, transform: ViewTransform): ImagePoint {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY,
  };
}

export function imageToViewRect(rect: ImageRect, transform: ViewTransform): ImageRect {
  const origin = imageToViewPoint(rect, transform);
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
