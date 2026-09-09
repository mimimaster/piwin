import { describe, expect, it } from 'vitest';
import {
  BROWSER_DEFAULT_DEVICE_SCALE_FACTOR,
  BROWSER_SCREENCAST_MAX_PX,
  clampBrowserDeviceScaleFactor,
  resolveBrowserScreencastSize,
} from './screencast-size.js';

describe('clampBrowserDeviceScaleFactor', () => {
  it('floors below 1 and caps at the workbench default', () => {
    expect(clampBrowserDeviceScaleFactor(Number.NaN)).toBe(1);
    expect(clampBrowserDeviceScaleFactor(0)).toBe(1);
    expect(clampBrowserDeviceScaleFactor(1)).toBe(1);
    expect(clampBrowserDeviceScaleFactor(1.5)).toBe(1.5);
    expect(clampBrowserDeviceScaleFactor(3)).toBe(BROWSER_DEFAULT_DEVICE_SCALE_FACTOR);
  });
});

describe('resolveBrowserScreencastSize', () => {
  it('maps the default CSS viewport at DSF 2 onto 2560×1600', () => {
    expect(resolveBrowserScreencastSize({ width: 1280, height: 800 })).toEqual({
      width: 2560,
      height: 1600,
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

  it('keeps both axes covering the compositor until the longest-edge cap', () => {
    expect(
      resolveBrowserScreencastSize({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2,
        maxPx: BROWSER_SCREENCAST_MAX_PX,
      }),
    ).toEqual({ width: 2560, height: 1440 });
  });

  it('returns null for empty or non-finite boxes', () => {
    expect(resolveBrowserScreencastSize({ width: 0, height: 800 })).toBeNull();
    expect(resolveBrowserScreencastSize({ width: 1280, height: Number.NaN })).toBeNull();
    expect(
      resolveBrowserScreencastSize({ width: 1280, height: 800, maxPx: 0 }),
    ).toBeNull();
  });
});
