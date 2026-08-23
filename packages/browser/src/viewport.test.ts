import { describe, expect, it } from 'vitest';
import { BROWSER_VIEWPORT_MIN_PX, clampBrowserViewport } from './viewport.js';

describe('clampBrowserViewport', () => {
  it('keeps a panel-sized viewport under the dimension cap', () => {
    expect(clampBrowserViewport(640, 900, 1280)).toEqual({ width: 640, height: 900 });
  });

  it('scales down a huge panel while preserving aspect ratio', () => {
    expect(clampBrowserViewport(1600, 1000, 1280)).toEqual({ width: 1280, height: 800 });
  });

  it('floors tiny boxes to the minimum usable viewport', () => {
    expect(clampBrowserViewport(40, 40, 1280)).toEqual({
      width: BROWSER_VIEWPORT_MIN_PX,
      height: BROWSER_VIEWPORT_MIN_PX,
    });
  });

  it('returns null for non-finite or empty measurements', () => {
    expect(clampBrowserViewport(0, 800, 1280)).toBeNull();
    expect(clampBrowserViewport(Number.NaN, 800, 1280)).toBeNull();
  });
});
