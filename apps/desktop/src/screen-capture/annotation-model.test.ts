import { describe, expect, it } from 'vitest';
import {
  annotationStyle,
  applyAnnotationAction,
  arrowGeometry,
  canRedoAnnotation,
  canUndoAnnotation,
  createAnnotationHistory,
  exportRegion,
  fitViewTransform,
  imageToViewPoint,
  normalizeCropRect,
  rectFromPoints,
  redoAnnotation,
  undoAnnotation,
  viewToImagePoint,
  type AnnotationHistory,
} from './annotation-model.js';

const IMAGE = { width: 1000, height: 600 };

function addRect(history: AnnotationHistory, x: number): AnnotationHistory {
  return applyAnnotationAction(history, {
    type: 'add-shape',
    shape: { kind: 'rect', rect: { x, y: 10, width: 50, height: 40 } },
  });
}

describe('crop normalization (SC-T01)', () => {
  it('flips a crop dragged up and to the left', () => {
    expect(normalizeCropRect({ x: 300, y: 200, width: -100, height: -50 }, IMAGE)).toEqual({
      x: 200,
      y: 150,
      width: 100,
      height: 50,
    });
  });

  it('clamps a crop that runs past the image edges', () => {
    expect(normalizeCropRect({ x: -20, y: 500, width: 200, height: 300 }, IMAGE)).toEqual({
      x: 0,
      y: 500,
      width: 180,
      height: 100,
    });
  });

  it('treats zero area, a tiny drag, or the whole image as no crop', () => {
    expect(normalizeCropRect({ x: 10, y: 10, width: 0, height: 80 }, IMAGE)).toBeNull();
    expect(normalizeCropRect({ x: 10, y: 10, width: 2, height: 2 }, IMAGE)).toBeNull();
    expect(normalizeCropRect({ x: -5, y: -5, width: 2000, height: 2000 }, IMAGE)).toBeNull();
  });

  it('rounds the crop to whole pixels', () => {
    expect(normalizeCropRect({ x: 10.4, y: 20.6, width: 99.3, height: 50.2 }, IMAGE)).toEqual({
      x: 10,
      y: 21,
      width: 100,
      height: 50,
    });
  });

  it('builds a drag rect in any direction', () => {
    expect(rectFromPoints({ x: 80, y: 90 }, { x: 20, y: 30 }, IMAGE)).toEqual({
      x: 20,
      y: 30,
      width: 60,
      height: 60,
    });
  });

  it('exports the crop when set and the whole image otherwise', () => {
    let history = createAnnotationHistory(IMAGE);
    expect(exportRegion(history.present)).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
    history = applyAnnotationAction(history, {
      type: 'set-crop',
      crop: { x: 100, y: 100, width: 200, height: 100 },
    });
    expect(exportRegion(history.present)).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });
});

describe('undo and redo (SC-T02)', () => {
  it('undoes and redoes shapes in order', () => {
    let history = addRect(addRect(createAnnotationHistory(IMAGE), 10), 100);
    expect(history.present.shapes).toHaveLength(2);
    history = undoAnnotation(history);
    expect(history.present.shapes).toHaveLength(1);
    expect(canRedoAnnotation(history)).toBe(true);
    history = redoAnnotation(history);
    expect(history.present.shapes).toHaveLength(2);
    expect(canRedoAnnotation(history)).toBe(false);
  });

  it('clears redo after a new edit', () => {
    let history = addRect(addRect(createAnnotationHistory(IMAGE), 10), 100);
    history = undoAnnotation(history);
    history = addRect(history, 200);
    expect(canRedoAnnotation(history)).toBe(false);
    expect(history.present.shapes.map((shape) => shape.kind === 'rect' && shape.rect.x)).toEqual([
      10, 200,
    ]);
  });

  it('makes crop undoable', () => {
    let history = applyAnnotationAction(createAnnotationHistory(IMAGE), {
      type: 'set-crop',
      crop: { x: 0, y: 0, width: 300, height: 300 },
    });
    expect(history.present.crop).not.toBeNull();
    history = undoAnnotation(history);
    expect(history.present.crop).toBeNull();
    expect(canUndoAnnotation(history)).toBe(false);
  });

  it('does not record degenerate edits as undo steps', () => {
    const start = createAnnotationHistory(IMAGE);
    const tinyRect = applyAnnotationAction(start, {
      type: 'add-shape',
      shape: { kind: 'rect', rect: { x: 5, y: 5, width: 2, height: 30 } },
    });
    const emptyText = applyAnnotationAction(start, {
      type: 'add-shape',
      shape: { kind: 'text', at: { x: 5, y: 5 }, text: '   ' },
    });
    const shortArrow = applyAnnotationAction(start, {
      type: 'add-shape',
      shape: { kind: 'arrow', from: { x: 5, y: 5 }, to: { x: 6, y: 6 } },
    });
    const noCropChange = applyAnnotationAction(start, { type: 'set-crop', crop: null });
    for (const result of [tinyRect, emptyText, shortArrow, noCropChange]) {
      expect(result).toBe(start);
    }
  });

  it('collapses whitespace in text and clamps its anchor', () => {
    const history = applyAnnotationAction(createAnnotationHistory(IMAGE), {
      type: 'add-shape',
      shape: { kind: 'text', at: { x: 1200, y: -4 }, text: '  login \n button  ' },
    });
    expect(history.present.shapes[0]).toEqual({
      kind: 'text',
      id: 'text-1',
      at: { x: 1000, y: 0 },
      text: 'login button',
    });
  });
});

describe('view transform (SC-T03)', () => {
  it('round-trips points within half a pixel at 2x downscale', () => {
    const image = { width: 2880, height: 1800 };
    const transform = fitViewTransform(image, { width: 1440, height: 1000 });
    expect(transform.scale).toBeCloseTo(0.5);
    for (const point of [
      { x: 0, y: 0 },
      { x: 1234.5, y: 987.25 },
      { x: 2880, y: 1800 },
    ]) {
      const back = viewToImagePoint(imageToViewPoint(point, transform), transform);
      expect(Math.abs(back.x - point.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(back.y - point.y)).toBeLessThanOrEqual(0.5);
    }
  });

  it('centers the image and never enlarges it', () => {
    const transform = fitViewTransform({ width: 400, height: 200 }, { width: 1000, height: 800 });
    expect(transform).toEqual({ scale: 1, offsetX: 300, offsetY: 300 });
  });

  it('falls back to identity for an empty view', () => {
    expect(fitViewTransform(IMAGE, { width: 0, height: 0 })).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });
});

describe('style constants (SC-T04)', () => {
  it.each([
    [1280, 3, 21],
    [2880, 7, 48],
    [5120, 13, 85],
  ])('long edge %i gives stroke %i and font %i', (longEdge, stroke, font) => {
    const style = annotationStyle({ width: longEdge, height: Math.round(longEdge * 0.6) });
    expect(style.strokeWidth).toBe(stroke);
    expect(style.fontSize).toBe(font);
    expect(style.arrowHeadLength).toBe(stroke * 4);
    expect(style.textHaloWidth).toBe(font / 8);
  });

  it('keeps minimums for small captures', () => {
    const style = annotationStyle({ width: 300, height: 200 });
    expect(style.strokeWidth).toBe(3);
    expect(style.fontSize).toBe(16);
  });
});

describe('arrow geometry', () => {
  it('puts the head tip at the arrow end and the shaft end behind it', () => {
    const { head, shaftEnd } = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(head[1]).toEqual({ x: 100, y: 0 });
    expect(head[0].x).toBeLessThan(100);
    expect(head[0].y).toBeCloseTo(-head[2].y);
    expect(shaftEnd.y).toBeCloseTo(0);
    expect(shaftEnd.x).toBeLessThan(100);
    expect(shaftEnd.x).toBeGreaterThan(head[0].x - 0.001);
  });

  it('shrinks the head for an arrow shorter than the head', () => {
    const { head } = arrowGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, 40);
    expect(head[0].x).toBeGreaterThanOrEqual(0 - 0.001);
  });
});
