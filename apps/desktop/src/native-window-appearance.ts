/**
 * Keeps the native window's appearance on the app theme's mode.
 *
 * The window material behind the WebView (styles/window-material.css) is an
 * NSVisualEffectView, which renders light or dark from the *window's*
 * appearance, not from our CSS. Without this, an ink theme on a light-mode
 * Mac would tint a bright material and the sidebar would read washed out.
 */
import type { ThemeManifest } from '@piwin/contracts';
import { readWindowChromeFromEnvironment } from './window-chrome.js';

export function syncNativeWindowAppearance(mode: ThemeManifest['mode']): void {
  if (readWindowChromeFromEnvironment() !== 'macos-overlay') {
    return;
  }
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(mode))
    .catch((error: unknown) => {
      console.warn('[native-window-appearance] setTheme failed:', error);
    });
}
