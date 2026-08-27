import { describe, expect, it } from 'vitest';
import {
  CANVAS_FIT_MAX_SCALE,
  pickCanvasStageFit,
  resolveCanvasStageFit,
} from './canvas-stage-fit.js';

describe('resolveCanvasStageFit', () => {
  it('leaves a scrolling document that already fills the column', () => {
    expect(
      resolveCanvasStageFit({
        viewportWidth: 560,
        viewportHeight: 800,
        contentWidth: 560,
        contentHeight: 2400,
      }),
    ).toEqual({ action: 'none', scale: 1 });
  });

  it('expands a portrait poster that letterboxes the panel sides', () => {
    expect(
      resolveCanvasStageFit({
        viewportWidth: 560,
        viewportHeight: 800,
        contentWidth: 360,
        contentHeight: 800,
      }),
    ).toEqual({ action: 'fill-viewport', scale: 1 });
  });

  it('scales up a small card that is short on both axes', () => {
    const decision = resolveCanvasStageFit({
      viewportWidth: 560,
      viewportHeight: 900,
      contentWidth: 360,
      contentHeight: 640,
    });
    expect(decision.action).toBe('contain-scale');
    expect(decision.scale).toBeCloseTo(Math.min(560 / 360, 900 / 640), 5);
  });

  it('caps runaway scale', () => {
    expect(
      resolveCanvasStageFit({
        viewportWidth: 800,
        viewportHeight: 800,
        contentWidth: 40,
        contentHeight: 40,
      }),
    ).toEqual({ action: 'contain-scale', scale: CANVAS_FIT_MAX_SCALE });
  });

  it('does not stretch a short full-width card', () => {
    expect(
      resolveCanvasStageFit({
        viewportWidth: 560,
        viewportHeight: 800,
        contentWidth: 560,
        contentHeight: 220,
      }),
    ).toEqual({ action: 'none', scale: 1 });
  });

  it('does not change a stage that already fills the iframe', () => {
    expect(
      resolveCanvasStageFit({
        viewportWidth: 560,
        viewportHeight: 800,
        contentWidth: 560,
        contentHeight: 800,
      }),
    ).toEqual({ action: 'none', scale: 1 });
  });

  it('rejects non-finite or tiny boxes', () => {
    expect(
      resolveCanvasStageFit({
        viewportWidth: Number.NaN,
        viewportHeight: 800,
        contentWidth: 200,
        contentHeight: 200,
      }),
    ).toEqual({ action: 'none', scale: 1 });
    expect(
      resolveCanvasStageFit({
        viewportWidth: 20,
        viewportHeight: 800,
        contentWidth: 200,
        contentHeight: 200,
      }),
    ).toEqual({ action: 'none', scale: 1 });
  });
});

describe('pickCanvasStageFit', () => {
  it('prefers the inner portrait poster over a full-size wrapper', () => {
    const picked = pickCanvasStageFit([
      {
        id: 'wrapper',
        viewportWidth: 560,
        viewportHeight: 800,
        contentWidth: 560,
        contentHeight: 800,
      },
      {
        id: 'poster',
        viewportWidth: 560,
        viewportHeight: 800,
        contentWidth: 360,
        contentHeight: 800,
      },
    ]);
    expect(picked?.id).toBe('poster');
    expect(picked?.decision.action).toBe('fill-viewport');
  });

  it('prefers fill-viewport over contain-scale when both match', () => {
    const picked = pickCanvasStageFit([
      {
        id: 'card',
        viewportWidth: 560,
        viewportHeight: 900,
        contentWidth: 200,
        contentHeight: 200,
      },
      {
        id: 'poster',
        viewportWidth: 560,
        viewportHeight: 900,
        contentWidth: 320,
        contentHeight: 880,
      },
    ]);
    expect(picked?.id).toBe('poster');
    expect(picked?.decision.action).toBe('fill-viewport');
  });

  it('returns null when every candidate already fits', () => {
    expect(
      pickCanvasStageFit([
        {
          id: 'full',
          viewportWidth: 560,
          viewportHeight: 800,
          contentWidth: 560,
          contentHeight: 800,
        },
      ]),
    ).toBeNull();
  });
});
