/**
 * Host diagnostic log ring-buffer. Entries live in a store outside React so a
 * `host/log` push re-renders only the chrome that reads the log (settings),
 * not the workbench root that receives the push.
 */
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { HostLogEntry } from './HostLogPanel';

export type HostLogContextValue = {
  entries: HostLogEntry[];
  onClear: () => void;
};

export type HostLogStore = {
  getEntries: () => HostLogEntry[];
  /** Same shape as a `useState` setter, so writers need not know about the store. */
  setEntries: Dispatch<SetStateAction<HostLogEntry[]>>;
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
};

const NO_ENTRIES: HostLogEntry[] = [];

export function createHostLogStore(initialEntries: HostLogEntry[] = NO_ENTRIES): HostLogStore {
  let entries = initialEntries;
  const listeners = new Set<() => void>();
  const setEntries: HostLogStore['setEntries'] = (action) => {
    const next = typeof action === 'function' ? action(entries) : action;
    if (next === entries) return;
    entries = next;
    for (const listener of listeners) listener();
  };
  return {
    getEntries: () => entries,
    setEntries,
    clear: () => setEntries(NO_ENTRIES),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const HostLogContext = createContext<HostLogStore | null>(null);

export function HostLogProvider(props: {
  store: HostLogStore;
  children: ReactNode;
}): ReactElement {
  return <HostLogContext.Provider value={props.store}>{props.children}</HostLogContext.Provider>;
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

function readNoEntries(): HostLogEntry[] {
  return NO_ENTRIES;
}

export function useHostLog(): HostLogContextValue | null {
  const store = useContext(HostLogContext);
  const entries = useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    store?.getEntries ?? readNoEntries,
  );
  return useMemo(
    () => (store === null ? null : { entries, onClear: () => store.clear() }),
    [store, entries],
  );
}
