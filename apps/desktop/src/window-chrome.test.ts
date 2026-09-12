import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyWindowChromeToDocument,
  MACOS_OVERLAY_CLEARANCE_PX,
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

  it('uses the OS frame on Windows and Linux packaged shells', () => {
    expect(
      resolveWindowChrome({
        isTauri: true,
        platform: 'Win32',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      }),
    ).toBe('native-frame');
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
