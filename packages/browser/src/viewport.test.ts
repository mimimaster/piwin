import { describe, expect, it } from 'vitest';
import {
  BROWSER_DEFAULT_VIEWPORT_HEIGHT,
  BROWSER_DEFAULT_VIEWPORT_WIDTH,
} from '@piwin/contracts';
import {
  BROWSER_FOLLOW_VIEWPORT_MIN_HEIGHT,
  BROWSER_FOLLOW_VIEWPORT_MIN_WIDTH,
  BROWSER_VIEWPORT_MIN_PX,
  clampBrowserViewport,
  resolveBrowserViewport,
} from './viewport.js';

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

describe('resolveBrowserViewport', () => {
  it('keeps a 40×40 panel at 1280×800 in fixed mode', () => {
    expect(
      resolveBrowserViewport({
        mode: 'fixed',
        panelWidth: 40,
        panelHeight: 40,
        maxDimension: 1280,
      }),
    ).toEqual({
      width: BROWSER_DEFAULT_VIEWPORT_WIDTH,
      height: BROWSER_DEFAULT_VIEWPORT_HEIGHT,
    });
  });

  it('defaults to fixed 1280×800 when mode is omitted', () => {
    expect(
      resolveBrowserViewport({
        panelWidth: 40,
        panelHeight: 40,
        maxDimension: 1280,
      }),
    ).toEqual({ width: 1280, height: 800 });
  });

  it('honors an explicit fixed size and still ignores the panel', () => {
    expect(
      resolveBrowserViewport({
        mode: 'fixed',
        width: 1024,
        height: 768,
        panelWidth: 40,
        panelHeight: 40,
        maxDimension: 1280,
      }),
    ).toEqual({ width: 1024, height: 768 });
  });

  it('raises a 40×40 follow panel to at least 1024×640', () => {
    const next = resolveBrowserViewport({
      mode: 'follow',
      panelWidth: 40,
      panelHeight: 40,
      maxDimension: 1280,
    });
    expect(next).toEqual({ width: 1024, height: 1024 });
    expect(next?.width).toBeGreaterThanOrEqual(BROWSER_FOLLOW_VIEWPORT_MIN_WIDTH);
    expect(next?.height).toBeGreaterThanOrEqual(BROWSER_FOLLOW_VIEWPORT_MIN_HEIGHT);
  });

  it('keeps a 1600×1000 follow panel without the 1280 longest-edge cap', () => {
    expect(
      resolveBrowserViewport({
        mode: 'follow',
        panelWidth: 1600,
        panelHeight: 1000,
        maxDimension: 1280,
      }),
    ).toEqual({ width: 1600, height: 1000 });
  });

  it('fits follow into 1920×1200 after the min floor, ignoring maxDimension', () => {
    const next = resolveBrowserViewport({
      mode: 'follow',
      panelWidth: 40,
      panelHeight: 4000,
      maxDimension: 1280,
    });
    expect(next).not.toBeNull();
    expect(next?.width ?? 0).toBeLessThanOrEqual(1920);
    expect(next?.height ?? 0).toBeLessThanOrEqual(1200);
  });

  it('ignores hidden follow measurements', () => {
    expect(
      resolveBrowserViewport({
        mode: 'follow',
        panelWidth: 0,
        panelHeight: 800,
        maxDimension: 1280,
      }),
    ).toBeNull();
    expect(
      resolveBrowserViewport({
        mode: 'follow',
        panelWidth: Number.NaN,
        panelHeight: 800,
        maxDimension: 1280,
      }),
    ).toBeNull();
  });

  it('honors mobile and custom sizes without the desktop min', () => {
    expect(
      resolveBrowserViewport({
        mode: 'mobile',
        width: 390,
        height: 844,
        panelWidth: 40,
        panelHeight: 40,
        maxDimension: 1280,
      }),
    ).toEqual({ width: 390, height: 844 });
    expect(
      resolveBrowserViewport({
        mode: 'custom',
        width: 1440,
        height: 900,
        maxDimension: 1280,
      }),
    ).toEqual({ width: 1280, height: 800 });
  });

  it('returns null when mobile/custom omit an explicit size', () => {
    expect(
      resolveBrowserViewport({
        mode: 'mobile',
        panelWidth: 800,
        panelHeight: 600,
        maxDimension: 1280,
      }),
    ).toBeNull();
  });
});
