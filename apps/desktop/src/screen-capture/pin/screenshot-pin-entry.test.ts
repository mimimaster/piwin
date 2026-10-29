import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('screenshot pin entry boundary', () => {
  it('uses a dedicated HTML and React entry instead of the Desktop composition root', () => {
    const html = readSource('../../../screenshot-pin.html');
    const entry = readSource('../../screenshot-pin-main.tsx');

    expect(html).toContain('/src/screenshot-pin-main.tsx');
    expect(html).not.toContain('/src/main.tsx');
    expect(entry).toContain("import { ScreenshotPinApp } from './screen-capture/pin/ScreenshotPinApp'");
    expect(entry).not.toContain('DesktopThemeRoot');
    expect(entry).not.toContain("'./styles.css'");
  });

  it('points the native pin window at the dedicated page', () => {
    const nativeSource = readSource('../../../src-tauri/src/screen_capture/pin.rs');
    const nativeRoot = readSource('../../../src-tauri/src/lib.rs');
    expect(nativeSource).toContain('WebviewUrl::App("screenshot-pin.html".into())');
    expect(nativeSource).not.toContain('WebviewUrl::App("index.html".into())');
    expect(nativeSource).toContain('window.destroy()');
    expect(nativeRoot).toContain('screen_capture::pin::is_pin_window_label');
  });
});
