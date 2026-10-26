/**
 * Screenshot annotation model (spec 2026-10-25 §6).
 *
 * Every coordinate is in image pixels, so export does not depend on window
 * size or display scale. The view only maps through a `ViewTransform`.
 */

export type ImagePoint = { x: number; y: number };

export type ImageRect = { x: number; y: number; width: number; height: number };

export type ImageSize = { width: number; height: number };

export type AnnotationTool = 'rect' | 'arrow' | 'text' | 'crop';

export type AnnotationShape =
  | { kind: 'rect'; id: string; rect: ImageRect }
  | { kind: 'arrow'; id: string; from: ImagePoint; to: ImagePoint }
  | { kind: 'text'; id: string; at: ImagePoint; text: string };

/** A shape before the model assigns its id. */
export type AnnotationShapeDraft =
  | { kind: 'rect'; rect: ImageRect }
  | { kind: 'arrow'; from: ImagePoint; to: ImagePoint }
  | { kind: 'text'; at: ImagePoint; text: string };

export type AnnotationDocument = {
  image: ImageSize;
  shapes: readonly AnnotationShape[];
  /** `null` keeps the whole image. */
  crop: ImageRect | null;
};

export type AnnotationHistory = {
  past: readonly AnnotationDocument[];
  present: AnnotationDocument;
  future: readonly AnnotationDocument[];
};

export type AnnotationAction =
  { type: 'add-shape'; shape: AnnotationShapeDraft } | { type: 'set-crop'; crop: ImageRect | null };

export type AnnotationStyle = {
  color: string;
  strokeWidth: number;
  fontSize: number;
  textHaloWidth: number;
  arrowHeadLength: number;
};

/** Maps image pixels to view pixels: `view = image * scale + offset`. */
export type ViewTransform = { scale: number; offsetX: number; offsetY: number };

export const ANNOTATION_COLOR = '#E5322D';
/** Smaller drags are treated as accidental clicks and dropped. */
export const MIN_SHAPE_SIZE_PX = 4;
const ARROW_HEAD_HALF_ANGLE_RAD = (28 * Math.PI) / 180;

export function createAnnotationHistory(image: ImageSize): AnnotationHistory {
  return { past: [], present: { image, shapes: [], crop: null }, future: [] };
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
 * Apply one edit. A degenerate edit (tiny drag, empty text, crop equal to the
 * current one) returns the same history so it never becomes an undo step.
 */
export function applyAnnotationAction(
  history: AnnotationHistory,
  action: AnnotationAction,
): AnnotationHistory {
  const nextDocument = nextAnnotationDocument(history.present, action);
  if (nextDocument === history.present) {
    return history;
  }
  return { past: [...history.past, history.present], present: nextDocument, future: [] };
}

function nextAnnotationDocument(
  document: AnnotationDocument,
  action: AnnotationAction,
): AnnotationDocument {
  if (action.type === 'set-crop') {
    const crop = action.crop === null ? null : normalizeCropRect(action.crop, document.image);
    if (sameRect(crop, document.crop)) {
      return document;
    }
    return { ...document, crop };
  }
  const shape = finalizeShape(action.shape, document);
  if (shape === null) {
    return document;
  }
  return { ...document, shapes: [...document.shapes, shape] };
}

function finalizeShape(
  draft: AnnotationShapeDraft,
  document: AnnotationDocument,
): AnnotationShape | null {
  const id = `${draft.kind}-${document.shapes.length + 1}`;
  if (draft.kind === 'rect') {
    const rect = clampRectToImage(draft.rect, document.image);
    if (rect.width < MIN_SHAPE_SIZE_PX || rect.height < MIN_SHAPE_SIZE_PX) {
      return null;
    }
    return { kind: 'rect', id, rect };
  }
  if (draft.kind === 'arrow') {
    const from = clampPointToImage(draft.from, document.image);
    const to = clampPointToImage(draft.to, document.image);
    if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_SHAPE_SIZE_PX) {
      return null;
    }
    return { kind: 'arrow', id, from, to };
  }
  const text = draft.text.replace(/\s+/g, ' ').trim();
  if (text.length === 0) {
    return null;
  }
  return { kind: 'text', id, at: clampPointToImage(draft.at, document.image), text };
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

/**
 * Crop rect rounded to whole pixels (canvas export needs integers). A crop
 * too small to be intentional, or covering the whole image, means "no crop".
 */
export function normalizeCropRect(rect: ImageRect, image: ImageSize): ImageRect | null {
  const clamped = clampRectToImage(rect, image);
  const x = Math.round(clamped.x);
  const y = Math.round(clamped.y);
  const width = Math.round(clamped.x + clamped.width) - x;
  const height = Math.round(clamped.y + clamped.height) - y;
  if (width < MIN_SHAPE_SIZE_PX || height < MIN_SHAPE_SIZE_PX) {
    return null;
  }
  if (x === 0 && y === 0 && width === image.width && height === image.height) {
    return null;
  }
  return { x, y, width, height };
}

/** Region the export keeps: the crop, or the whole image. */
export function exportRegion(document: AnnotationDocument): ImageRect {
  return (
    document.crop ?? { x: 0, y: 0, width: document.image.width, height: document.image.height }
  );
}

export function clampPointToImage(point: ImagePoint, image: ImageSize): ImagePoint {
  return { x: clamp(point.x, 0, image.width), y: clamp(point.y, 0, image.height) };
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

function sameRect(left: ImageRect | null, right: ImageRect | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
