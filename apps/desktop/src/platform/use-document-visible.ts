import { useSyncExternalStore } from 'react';
import { getWindowPresence, subscribeWindowPresence } from './window-focus-signal.js';

const readDocumentVisible = (): boolean => getWindowPresence().documentVisible;

/** Losing keyboard focus must not pause another visible browser window. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeWindowPresence, readDocumentVisible, () => true);
}
