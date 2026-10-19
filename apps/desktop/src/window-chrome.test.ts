import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  applyNativeWindowMaterialToDocument,
  applyWindowChromeToDocument,
  isWindowsMicaSupported,
  MACOS_OVERLAY_CLEARANCE_PX,
  readNativeWindowMaterial,
  resolveWindowChrome,
} from './window-chrome.js';

const tokensCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'styles/tokens.css'),
  'utf8',
);

describe('resolveWindowChrome', () => {
  it('treats a browser tab as web even on a Mac user agent', () => {
    expect(
      resolveWindowChrome({
        isTauri: false,
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      }),
    ).toBe('web');
  });

  it('reserves Overlay clearance only for the macOS packaged shell', () => {
    expect(
      resolveWindowChrome({
        isTauri: true,
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      }),
    ).toBe('macos-overlay');
  });

  it('uses windows-caption on Windows packaged shell and native-frame on Linux', () => {
    expect(
      resolveWindowChrome({
        isTauri: true,
        platform: 'Win32',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      }),
    ).toBe('windows-caption');
    expect(
      resolveWindowChrome({
        isTauri: true,
        platform: 'Linux x86_64',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      }),
    ).toBe('native-frame');
  });
});

describe('applyWindowChromeToDocument', () => {
  function fakeRoot(): HTMLElement {
    return { dataset: {} } as HTMLElement;
  }

  it('writes both chrome and runtime attributes', () => {
    const root = fakeRoot();
    applyWindowChromeToDocument(root, 'native-frame');
    expect(root.dataset.windowChrome).toBe('native-frame');
    expect(root.dataset.runtime).toBe('tauri');
  });

  it('marks the browser runtime as web', () => {
    const root = fakeRoot();
    applyWindowChromeToDocument(root, 'web');
    expect(root.dataset.windowChrome).toBe('web');
    expect(root.dataset.runtime).toBe('web');
  });

  it('marks windows caption chrome', () => {
    const root = fakeRoot();
    applyWindowChromeToDocument(root, 'windows-caption');
    expect(root.dataset.windowChrome).toBe('windows-caption');
    expect(root.dataset.runtime).toBe('tauri');
  });
});

describe('native window material', () => {
  function fakeRoot(): HTMLElement {
    return { dataset: {} } as HTMLElement;
  }

  function windowsNavigator(platformVersion: string | undefined) {
    return {
      userAgentData: {
        getHighEntropyValues: async () => (platformVersion === undefined ? {} : { platformVersion }),
      },
    };
  }

  it('detects Windows 11 from the client-hints platform version', async () => {
    expect(await isWindowsMicaSupported(windowsNavigator('15.0.0'))).toBe(true);
    expect(await isWindowsMicaSupported(windowsNavigator('13.0.0'))).toBe(true);
    expect(await isWindowsMicaSupported(windowsNavigator('10.0.0'))).toBe(false);
    expect(await isWindowsMicaSupported(windowsNavigator(undefined))).toBe(false);
    expect(await isWindowsMicaSupported({})).toBe(false);
  });

  it('marks vibrancy synchronously behind the macOS window', () => {
    const root = fakeRoot();
    void applyNativeWindowMaterialToDocument(root, 'macos-overlay', {});
    expect(readNativeWindowMaterial(root)).toBe('vibrancy');
  });

  it('marks Mica only on Windows 11', async () => {
    const win11 = fakeRoot();
    await applyNativeWindowMaterialToDocument(win11, 'windows-caption', windowsNavigator('15.0.0'));
    expect(readNativeWindowMaterial(win11)).toBe('mica');

    const win10 = fakeRoot();
    await applyNativeWindowMaterialToDocument(win10, 'windows-caption', windowsNavigator('10.0.0'));
    expect(readNativeWindowMaterial(win10)).toBeUndefined();
  });

  it('keeps the window opaque when the version probe fails', async () => {
    const root = fakeRoot();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await applyNativeWindowMaterialToDocument(root, 'windows-caption', {
      userAgentData: { getHighEntropyValues: async () => Promise.reject(new Error('denied')) },
    });
    expect(readNativeWindowMaterial(root)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('has no material on Linux or in a browser tab', async () => {
    for (const chrome of ['native-frame', 'web'] as const) {
      const root = fakeRoot();
      root.dataset.nativeWindowMaterial = 'vibrancy';
      await applyNativeWindowMaterialToDocument(root, chrome, windowsNavigator('15.0.0'));
      expect(readNativeWindowMaterial(root)).toBeUndefined();
    }
  });
});

describe('window chrome tokens', () => {
  it('defaults clearance to zero and only Overlay pays the Mac hole', () => {
    expect(tokensCss).toMatch(/--traffic-light-clearance:\s*0px/);
    expect(tokensCss).toContain(
      `html[data-window-chrome='macos-overlay']`,
    );
    expect(tokensCss).toMatch(
      new RegExp(
        `html\\[data-window-chrome='macos-overlay'\\][^{]*\\{[^}]*--traffic-light-clearance:\\s*${MACOS_OVERLAY_CLEARANCE_PX}px`,
      ),
    );
    expect(tokensCss).toMatch(
      /--titleband-leading:\s*max\(var\(--s-3\),\s*calc\(var\(--traffic-light-clearance\)\s*-\s*var\(--deck-inset\)\)\)/,
    );
    expect(tokensCss).toMatch(
      /--titleband-flush-leading:\s*max\(var\(--s-3\),\s*var\(--traffic-light-clearance\)\)/,
    );
  });
});
