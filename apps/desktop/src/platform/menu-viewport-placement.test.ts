import { describe, expect, it } from 'vitest';
import { placeMenuInViewport } from './menu-viewport-placement';

const viewport = { width: 1000, height: 650 };
const menuSize = { width: 170, height: 300 };

describe('placeMenuInViewport', () => {
  it('keeps the anchor when the menu fits down-right', () => {
    expect(placeMenuInViewport({ anchor: { x: 100, y: 100 }, menuSize, viewport })).toEqual({
      x: 100,
      y: 100,
    });
  });

  it('flips upward when the menu would cross the bottom edge', () => {
    expect(placeMenuInViewport({ anchor: { x: 100, y: 520 }, menuSize, viewport })).toEqual({
      x: 100,
      y: 220,
    });
  });

  it('flips left when the menu would cross the right edge', () => {
    expect(placeMenuInViewport({ anchor: { x: 900, y: 100 }, menuSize, viewport })).toEqual({
      x: 730,
      y: 100,
    });
  });

  it('pins against the edge when neither side fits', () => {
    expect(
      placeMenuInViewport({
        anchor: { x: 100, y: 200 },
        menuSize: { width: 170, height: 500 },
        viewport,
      }),
    ).toEqual({ x: 100, y: 142 });
  });

  it('never places above the top margin for menus taller than the viewport', () => {
    expect(
      placeMenuInViewport({
        anchor: { x: 100, y: 200 },
        menuSize: { width: 170, height: 900 },
        viewport,
      }),
    ).toEqual({ x: 100, y: 8 });
  });
});
