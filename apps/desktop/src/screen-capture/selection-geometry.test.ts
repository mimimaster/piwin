import { describe, expect, it } from 'vitest';
import {
  hitTestSelection,
  moveSelection,
  normalizeSelection,
  placeSizeBadge,
  placeToolbar,
  resizeSelection,
} from './selection-geometry.js';

const IMAGE = { width: 1000, height: 600 };
const REGION = { x: 100, y: 100, width: 200, height: 100 };

describe('hitTestSelection', () => {
  it('finds corner and edge handles before the inside', () => {
    expect(hitTestSelection(REGION, { x: 102, y: 98 }, 6)).toEqual({ kind: 'handle', handle: 'nw' });
    expect(hitTestSelection(REGION, { x: 200, y: 200 }, 6)).toEqual({ kind: 'handle', handle: 's' });
    expect(hitTestSelection(REGION, { x: 150, y: 150 }, 6)).toEqual({ kind: 'inside' });
    expect(hitTestSelection(REGION, { x: 50, y: 50 }, 6)).toEqual({ kind: 'outside' });
  });
});

describe('resizeSelection', () => {
  it('moves only the dragged edges', () => {
    expect(resizeSelection(REGION, 'se', { x: 50, y: 20 }, IMAGE)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 120,
    });
    expect(resizeSelection(REGION, 'n', { x: 999, y: -30 }, IMAGE)).toEqual({
      x: 100,
      y: 70,
      width: 200,
      height: 130,
    });
  });

  it('flips past the opposite edge and stays inside the image', () => {
    expect(resizeSelection(REGION, 'e', { x: -300, y: 0 }, IMAGE)).toEqual({
      x: 0,
      y: 100,
      width: 100,
      height: 100,
    });
  });
});

describe('moveSelection', () => {
  it('keeps the size and stops at the image edges', () => {
    expect(moveSelection(REGION, { x: 2000, y: -500 }, IMAGE)).toEqual({
      x: 800,
      y: 0,
      width: 200,
      height: 100,
    });
  });
});

describe('normalizeSelection', () => {
  it('rounds to whole pixels and rejects a click-sized region', () => {
    expect(normalizeSelection({ x: 10.4, y: 20.6, width: 99.3, height: -50.2 }, IMAGE)).toEqual({
      x: 10,
      y: 0,
      width: 100,
      height: 21,
    });
    expect(normalizeSelection({ x: 10, y: 10, width: 2, height: 2 }, IMAGE)).toBeNull();
  });

  it('allows the whole image', () => {
    expect(normalizeSelection({ x: -5, y: -5, width: 2000, height: 2000 }, IMAGE)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 600,
    });
  });
});

describe('placeToolbar', () => {
  const toolbar = { width: 300, height: 38 };
  const viewport = { width: 1440, height: 900 };

  it('goes under the region with right edges aligned', () => {
    expect(placeToolbar({ left: 500, top: 100, width: 400, height: 200 }, toolbar, viewport, 8)).toEqual({
      left: 600,
      top: 308,
    });
  });

  it('goes above when there is no room below, inside when neither fits', () => {
    expect(placeToolbar({ left: 500, top: 400, width: 400, height: 480 }, toolbar, viewport, 8)).toEqual({
      left: 600,
      top: 354,
    });
    expect(placeToolbar({ left: 0, top: 0, width: 1440, height: 900 }, toolbar, viewport, 8)).toEqual({
      left: 1132,
      top: 854,
    });
  });

  it('stays on screen for a region at the left edge', () => {
    expect(placeToolbar({ left: 0, top: 100, width: 100, height: 100 }, toolbar, viewport, 8).left).toBe(8);
  });
});

describe('placeSizeBadge', () => {
  it('sits above the region, or inside it at the top of the screen', () => {
    expect(placeSizeBadge({ left: 50, top: 100, width: 10, height: 10 }, 22, 4)).toEqual({ left: 50, top: 74 });
    expect(placeSizeBadge({ left: 50, top: 0, width: 10, height: 10 }, 22, 4)).toEqual({ left: 50, top: 4 });
  });
});
