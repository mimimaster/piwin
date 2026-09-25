import { useSyncExternalStore } from 'react';
import type { InkstoneRoute } from './inkstone-state.js';

/**
 * iPad landscape and wider: sessions stay docked on the left and the
 * current page fills the right (master–detail). Below this the app keeps the
 * phone's one-page-at-a-time flow.
 */
export const WIDE_LAYOUT_QUERY = '(min-width: 1024px)';

function mediaQuery(): MediaQueryList | undefined {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE_LAYOUT_QUERY)
    : undefined;
}

export function useWideLayout(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = mediaQuery();
      query?.addEventListener('change', listener);
      return () => query?.removeEventListener('change', listener);
    },
    () => mediaQuery()?.matches === true,
    () => false,
  );
}

/** Which bottom-nav tab a route belongs to (the docked list shows it on wide screens). */
export function navTabForRoute(route: InkstoneRoute): 'sessions' | 'activity' | 'knowledge' | 'desk' {
  switch (route) {
    case 'activity':
    case 'inbox':
      return 'activity';
    case 'knowledge':
    case 'cards':
    case 'wiki-detail':
      return 'knowledge';
    case 'desk':
    case 'shelf':
    case 'settings':
    case 'settings-detail':
    case 'library':
    case 'automations':
    case 'connect':
      return 'desk';
    default:
      return 'sessions';
  }
}
