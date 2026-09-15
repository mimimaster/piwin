/**
 * Shared reader for the document-level theme id (`data-theme-id`).
 *
 * Render-time `document` reads are not reactive: memoized transcript rows kept
 * the previous theme's labels after a switch. One MutationObserver serves every
 * subscriber, since call-chain rows mount by the hundred.
 */

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

/** Read the theme id already projected onto the document root. */
export function readThemeId(): string {
  if (typeof document === 'undefined') {
    return '';
  }
  return document.documentElement.getAttribute('data-theme-id') ?? '';
}

function subscribeToThemeId(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined;
  }
  listeners.add(onChange);
  if (observer === null) {
    observer = new MutationObserver(() => {
      for (const listener of listeners) listener();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-id'],
    });
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && observer !== null) {
      observer.disconnect();
      observer = null;
    }
  };
}

/** React hook that follows document-level theme id changes. */
export function useThemeId(): string {
  return useSyncExternalStore(subscribeToThemeId, readThemeId, () => '');
}
