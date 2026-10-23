/**
 * Keeps the native window's appearance on the app theme's mode.
 *
 * The window material behind the WebView (styles/window-material.css) is an
 * NSVisualEffectView on macOS or Mica on Windows 11; both render light or
 * dark from the *window's* theme, not from our CSS. Without this, an ink
 * theme on a light-mode desktop would tint a bright material and the sidebar
 * would read washed out.
 */
import type { ThemeManifest } from '@piwin/contracts';
import { readNativeWindowMaterial } from './window-chrome.js';

export function syncNativeWindowAppearance(mode: ThemeManifest['mode']): void {
  if (readNativeWindowMaterial() === undefined) {
    return;
  }
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(mode))
    .catch((error: unknown) => {
      console.warn('[native-window-appearance] setTheme failed:', error);
    });
}
