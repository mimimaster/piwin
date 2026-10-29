import { describe, expect, it } from 'vitest';
import {
  beginGesture,
  cursorForPoint,
  finishGesture,
  updateGesture,
  type GestureContext,
  type ScreenshotGesture,
} from './screenshot-gesture.js';

const IMAGE = { width: 1000, height: 600 };
const REGION = { x: 100, y: 100, width: 200, height: 100 };

function context(overrides: Partial<GestureContext> = {}): GestureContext {
  return {
    image: IMAGE,
    selection: null,
    tool: null,
    hasMarks: false,
    handleTolerance: 6,
    minStrokeDistance: 1,
    ...overrides,
  };
}

function drag(ctx: GestureContext, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = beginGesture(ctx, from);
  if (start.kind !== 'gesture') throw new Error(`no gesture: ${start.kind}`);
  const moved: ScreenshotGesture = updateGesture(start.gesture, to, ctx);
  return finishGesture(moved, IMAGE);
}

describe('step 1: picking a region', () => {
  it('drags out a region in any direction', () => {
    expect(drag(context(), { x: 400, y: 300 }, { x: 100, y: 50 })).toEqual({
      kind: 'selection',
      selection: { x: 100, y: 50, width: 300, height: 250 },
    });
  });

  it('takes the whole screen on a click', () => {
    expect(drag(context(), { x: 400, y: 300 }, { x: 401, y: 300 })).toEqual({
      kind: 'selection',
      selection: { x: 0, y: 0, width: 1000, height: 600 },
    });
  });
});

describe('step 2 without a tool: adjusting the region', () => {
  it('moves the region when dragged from inside', () => {
    expect(drag(context({ selection: REGION }), { x: 150, y: 150 }, { x: 170, y: 140 })).toEqual({
      kind: 'selection',
      selection: { x: 120, y: 90, width: 200, height: 100 },
    });
  });

  it('resizes from a handle', () => {
    expect(drag(context({ selection: REGION }), { x: 300, y: 200 }, { x: 350, y: 260 })).toEqual({
      kind: 'selection',
      selection: { x: 100, y: 100, width: 250, height: 160 },
    });
  });

  it('starts over with a drag outside the region only while nothing is drawn', () => {
    expect(drag(context({ selection: REGION }), { x: 600, y: 400 }, { x: 800, y: 500 })).toEqual({
      kind: 'selection',
      selection: { x: 600, y: 400, width: 200, height: 100 },
    });
    expect(
      drag(context({ selection: REGION, hasMarks: true }), { x: 600, y: 400 }, { x: 800, y: 500 }),
    ).toEqual({ kind: 'none' });
  });
});

describe('step 2: a click outside the region finishes', () => {
  it('finishes with or without a tool or marks', () => {
    for (const extra of [{}, { hasMarks: true }, { tool: 'rect' as const }]) {
      expect(
        drag(context({ selection: REGION, ...extra }), { x: 600, y: 400 }, { x: 601, y: 401 }),
      ).toEqual({ kind: 'finish' });
    }
  });

  it('does not finish on a click inside the region', () => {
    expect(drag(context({ selection: REGION }), { x: 150, y: 150 }, { x: 150, y: 150 }).kind).toBe(
      'selection',
    );
  });
});

describe('step 2 with a tool: drawing', () => {
  it('draws a box clamped to the region', () => {
    expect(drag(context({ selection: REGION, tool: 'rect' }), { x: 120, y: 120 }, { x: 900, y: 500 })).toEqual({
      kind: 'mark',
      draft: { kind: 'rect', rect: { x: 120, y: 120, width: 180, height: 80 } },
    });
  });

  it('records pen strokes and ignores presses outside the region', () => {
    const ctx = context({ selection: REGION, tool: 'pen' });
    const start = beginGesture(ctx, { x: 120, y: 120 });
    if (start.kind !== 'gesture') throw new Error('expected a stroke');
    let gesture = updateGesture(start.gesture, { x: 140, y: 120 }, ctx);
    gesture = updateGesture(gesture, { x: 160, y: 130 }, ctx);
    expect(finishGesture(gesture, IMAGE)).toEqual({
      kind: 'mark',
      draft: {
        kind: 'pen',
        points: [
          { x: 120, y: 120 },
          { x: 140, y: 120 },
          { x: 160, y: 130 },
        ],
      },
    });
    expect(drag(ctx, { x: 600, y: 400 }, { x: 700, y: 450 })).toEqual({ kind: 'none' });
  });

  it('opens a text field with the text tool', () => {
    expect(beginGesture(context({ selection: REGION, tool: 'text' }), { x: 150, y: 150 })).toEqual({
      kind: 'text',
      at: { x: 150, y: 150 },
    });
  });
});

describe('cursorForPoint', () => {
  it('mirrors what a press would do', () => {
    expect(cursorForPoint(context(), { x: 10, y: 10 })).toBe('crosshair');
    expect(cursorForPoint(context({ selection: REGION }), { x: 300, y: 200 })).toBe('nwse-resize');
    expect(cursorForPoint(context({ selection: REGION }), { x: 150, y: 150 })).toBe('move');
    expect(cursorForPoint(context({ selection: REGION, tool: 'text' }), { x: 150, y: 150 })).toBe('text');
    expect(cursorForPoint(context({ selection: REGION, tool: 'rect' }), { x: 600, y: 400 })).toBe('pointer');
  });
});
