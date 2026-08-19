import { describe, expect, it } from 'vitest';
import { coalesceMouseMoves, viewportFromDisplay } from './browser-workbench-pointer';

describe('viewportFromDisplay', () => {
  it('scales display px into CSS viewport px', () => {
    expect(
      viewportFromDisplay({
        displayX: 50,
        displayY: 25,
        displayWidth: 100,
        displayHeight: 50,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 640, y: 400 });
  });

  it('returns origin when the displayed box has no size', () => {
    expect(
      viewportFromDisplay({
        displayX: 10,
        displayY: 10,
        displayWidth: 0,
        displayHeight: 10,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe('coalesceMouseMoves', () => {
  it('keeps only the last of consecutive moves', () => {
    expect(
      coalesceMouseMoves([
        { type: 'mouse', action: 'move', x: 1, y: 1 },
        { type: 'mouse', action: 'move', x: 2, y: 2 },
        { type: 'mouse', action: 'down', x: 2, y: 2 },
        { type: 'mouse', action: 'move', x: 3, y: 3 },
      ]),
    ).toEqual([
      { type: 'mouse', action: 'move', x: 2, y: 2 },
      { type: 'mouse', action: 'down', x: 2, y: 2 },
      { type: 'mouse', action: 'move', x: 3, y: 3 },
    ]);
  });
});
