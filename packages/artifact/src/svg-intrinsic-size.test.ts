import { describe, expect, it } from 'vitest';
import { estimateSvgFenceHeight, parseSvgFenceIntrinsicSize } from './svg-intrinsic-size.js';

describe('parseSvgFenceIntrinsicSize', () => {
  it('reads width/height attributes from the root svg tag', () => {
    expect(
      parseSvgFenceIntrinsicSize(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><circle r="10"/></svg>',
      ),
    ).toEqual({ width: 800, height: 500 });
  });

  it('reads viewBox when attributes are missing', () => {
    expect(parseSvgFenceIntrinsicSize('<svg viewBox="0 0 1200 600"></svg>')).toEqual({
      width: 1200,
      height: 600,
    });
  });

  it('scales height from viewBox when only width is set', () => {
    expect(
      parseSvgFenceIntrinsicSize('<svg width="400" viewBox="0 0 800 400"></svg>'),
    ).toEqual({ width: 400, height: 200 });
  });

  it('returns null for non-svg source', () => {
    expect(parseSvgFenceIntrinsicSize('<div>hi</div>')).toBeNull();
  });
});

describe('estimateSvgFenceHeight', () => {
  it('maps viewBox aspect ratio onto the container width', () => {
    // 800×400 at 400px wide → 200 + 8 padding
    expect(
      estimateSvgFenceHeight({
        source: '<svg viewBox="0 0 800 400"></svg>',
        containerWidth: 400,
      }),
    ).toBe(208);
  });

  it('clamps to min/max bounds', () => {
    expect(
      estimateSvgFenceHeight({
        source: '<svg viewBox="0 0 10 1"></svg>',
        containerWidth: 100,
        minHeight: 80,
      }),
    ).toBe(80);

    expect(
      estimateSvgFenceHeight({
        source: '<svg viewBox="0 0 10 10000"></svg>',
        containerWidth: 400,
        maxHeight: 500,
      }),
    ).toBe(500);
  });

  it('falls back when geometry is missing', () => {
    expect(
      estimateSvgFenceHeight({
        source: '<svg></svg>',
        containerWidth: 400,
        fallbackHeight: 120,
        minHeight: 40,
      }),
    ).toBe(120);
  });
});
