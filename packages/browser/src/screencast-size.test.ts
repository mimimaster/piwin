import { describe, expect, it } from 'vitest';
import {
  BROWSER_DEFAULT_DEVICE_SCALE_FACTOR,
  BROWSER_MAX_DEVICE_SCALE_FACTOR,
  BROWSER_SCREENCAST_MAX_ENCODED_AREA,
  BROWSER_SCREENCAST_MAX_ENCODED_HEIGHT,
  BROWSER_SCREENCAST_MAX_ENCODED_WIDTH,
  clampBrowserDeviceScaleFactor,
  resolveBrowserScreencastFps,
  resolveBrowserScreencastSize,
} from './screencast-size.js';

describe('clampBrowserDeviceScaleFactor', () => {
  it('floors below 1 and caps at the workbench max', () => {
    expect(clampBrowserDeviceScaleFactor(Number.NaN)).toBe(1);
    expect(clampBrowserDeviceScaleFactor(0)).toBe(1);
    expect(clampBrowserDeviceScaleFactor(1)).toBe(1);
    expect(clampBrowserDeviceScaleFactor(1.5)).toBe(1.5);
    expect(clampBrowserDeviceScaleFactor(2)).toBe(2);
    expect(clampBrowserDeviceScaleFactor(3)).toBe(3);
    expect(clampBrowserDeviceScaleFactor(4)).toBe(BROWSER_MAX_DEVICE_SCALE_FACTOR);
  });
});

describe('resolveBrowserScreencastSize', () => {
  it('maps 1280×800 CSS at DSF 2 onto 2560×1600', () => {
    expect(resolveBrowserScreencastSize({ width: 1280, height: 800 })).toEqual({
      width: 2560,
      height: 1600,
    });
  });

  it('maps follow 1920×1200 CSS at DSF 2 onto 3840×2400', () => {
    expect(resolveBrowserScreencastSize({ width: 1920, height: 1200 })).toEqual({
      width: BROWSER_SCREENCAST_MAX_ENCODED_WIDTH,
      height: BROWSER_SCREENCAST_MAX_ENCODED_HEIGHT,
    });
  });

  it('maps 1280×800 CSS at DSF 3 onto 3840×2400', () => {
    expect(
      resolveBrowserScreencastSize({
        width: 1280,
        height: 800,
        deviceScaleFactor: 3,
      }),
    ).toEqual({
      width: BROWSER_SCREENCAST_MAX_ENCODED_WIDTH,
      height: BROWSER_SCREENCAST_MAX_ENCODED_HEIGHT,
    });
  });

  it('does not invent pixels when DSF is 1', () => {
    expect(
      resolveBrowserScreencastSize({
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
      }),
    ).toEqual({ width: 1280, height: 800 });
  });

  it('fits both axes into the encoded rectangle instead of a longest-edge cap', () => {
    expect(
      resolveBrowserScreencastSize({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2,
      }),
    ).toEqual({ width: 3840, height: 2160 });
  });

  it('scales by area when the rectangle still exceeds max area', () => {
    const size = resolveBrowserScreencastSize({
      width: 4000,
      height: 3000,
      deviceScaleFactor: 2,
    });
    expect(size).not.toBeNull();
    if (!size) return;
    expect(size.width).toBeLessThanOrEqual(BROWSER_SCREENCAST_MAX_ENCODED_WIDTH);
    expect(size.height).toBeLessThanOrEqual(BROWSER_SCREENCAST_MAX_ENCODED_HEIGHT);
    expect(size.width * size.height).toBeLessThanOrEqual(BROWSER_SCREENCAST_MAX_ENCODED_AREA);
  });

  it('returns null for empty or non-finite boxes', () => {
    expect(resolveBrowserScreencastSize({ width: 0, height: 800 })).toBeNull();
    expect(resolveBrowserScreencastSize({ width: 1280, height: Number.NaN })).toBeNull();
    expect(
      resolveBrowserScreencastSize({ width: 1280, height: 800, maxEncodedWidth: 0 }),
    ).toBeNull();
  });
});

describe('resolveBrowserScreencastFps', () => {
  it('uses 12 fps at or under 5e6 encoded pixels and 8 fps above', () => {
    expect(resolveBrowserScreencastFps(4_096_000)).toBe(12);
    expect(resolveBrowserScreencastFps(5_000_000)).toBe(12);
    expect(resolveBrowserScreencastFps(5_000_001)).toBe(8);
  });

  it('never exceeds the session maxFps', () => {
    expect(resolveBrowserScreencastFps(4_096_000, 4)).toBe(4);
    expect(resolveBrowserScreencastFps(9_000_000, 30)).toBe(8);
  });
});
