import { describe, expect, it } from 'vitest';
import { resolveShellRuntime } from './shell-runtime.js';

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

describe('resolveShellRuntime', () => {
  it('is a browser whenever the Tauri bridge is missing', () => {
    expect(
      resolveShellRuntime({ hasTauriBridge: false, userAgent: IPHONE_UA, maxTouchPoints: 5 }),
    ).toBe('browser');
    expect(
      resolveShellRuntime({ hasTauriBridge: false, userAgent: MAC_UA, maxTouchPoints: 0 }),
    ).toBe('browser');
  });

  it('keeps the Mac, Windows and Linux apps on the desktop runtime', () => {
    expect(
      resolveShellRuntime({ hasTauriBridge: true, userAgent: MAC_UA, maxTouchPoints: 0 }),
    ).toBe('desktop-tauri');
    expect(
      resolveShellRuntime({
        hasTauriBridge: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        // Touch laptops must not be mistaken for a phone.
        maxTouchPoints: 10,
      }),
    ).toBe('desktop-tauri');
  });

  it('recognises the iPhone shell even though its user agent mentions Mac OS X', () => {
    expect(
      resolveShellRuntime({ hasTauriBridge: true, userAgent: IPHONE_UA, maxTouchPoints: 5 }),
    ).toBe('mobile-tauri');
  });

  it('recognises iPadOS requesting the desktop site', () => {
    expect(
      resolveShellRuntime({ hasTauriBridge: true, userAgent: MAC_UA, maxTouchPoints: 5 }),
    ).toBe('mobile-tauri');
  });

  it('recognises the Android shell', () => {
    expect(
      resolveShellRuntime({
        hasTauriBridge: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36',
        maxTouchPoints: 5,
      }),
    ).toBe('mobile-tauri');
  });
});
