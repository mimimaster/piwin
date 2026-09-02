/**
 * Shared reader for the resolved desktop color mode.
 *
 * Appearance writes the resolved mode to the document root. Keeping the
 * observer here gives renderers one small external store instead of each
 * component maintaining its own MutationObserver and snapshot logic.
 */

import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark';

const DARK_MODE: ThemeMode = 'dark';

/** Read the mode already projected onto the document root. */
export function readThemeMode(): ThemeMode {
  if (typeof document === 'undefined') {
    return DARK_MODE;
  }
  return document.documentElement.dataset.themeMode === 'light' ? 'light' : DARK_MODE;
}

function subscribeToThemeMode(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined;
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === 'data-theme-mode')) {
      onChange();
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme-mode'],
  });
  return () => observer.disconnect();
}

/** React hook that follows document-level appearance changes. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeToThemeMode, readThemeMode, () => DARK_MODE);
}
