import { describe, expect, it } from 'vitest';
import { viewportFromCoverTopDisplay, wheelDeltaFromCoverDisplay } from './browser-mini-pointer';

describe('viewportFromCoverTopDisplay', () => {
  it('maps the top-left of a matching box onto the page origin', () => {
    expect(
      viewportFromCoverTopDisplay({
        displayX: 0,
        displayY: 0,
        displayWidth: 320,
        displayHeight: 200,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it('maps the bottom-right onto the CSS viewport', () => {
    expect(
      viewportFromCoverTopDisplay({
        displayX: 320,
        displayY: 200,
        displayWidth: 320,
        displayHeight: 200,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 1280, y: 800 });
  });
});

describe('wheelDeltaFromCoverDisplay', () => {
  it('scales wheel deltas into CSS viewport px', () => {
    expect(
      wheelDeltaFromCoverDisplay({
        deltaX: 0,
        deltaY: 40,
        displayWidth: 320,
        displayHeight: 200,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ deltaX: 0, deltaY: 160 });
  });
});
