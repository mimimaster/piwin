/**
 * True while the shell is in its phone layout. Phone is a pure width rule
 * (`resolveLayoutMode`), so a component deep in the composer can follow it
 * without the shell threading its layout mode through every pane.
 */
import { useSyncExternalStore } from 'react';
import { PHONE_SHELL_MAX_WIDTH } from '../tool-cards/shell-layout';

const PHONE_QUERY = `(max-width: ${PHONE_SHELL_MAX_WIDTH}px)`;

function phoneQuery(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return window.matchMedia(PHONE_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = phoneQuery();
  if (query === undefined) return () => undefined;
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readPhoneLayout(): boolean {
  return phoneQuery()?.matches === true;
}

export function usePhoneShellLayout(): boolean {
  return useSyncExternalStore(subscribe, readPhoneLayout, () => false);
}
