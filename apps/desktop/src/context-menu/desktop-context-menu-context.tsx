/**
 * App-level Context Menu wiring (CM P1).
 * One provider owns caps + dispatchers; deep components (chat rows, tool
 * cards, diff cards, markdown code blocks) consume it without prop drilling.
 */
import {
  createContext,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { ContextMenuCapabilities, ContextMenuDispatchers } from './index.js';

export type DesktopContextMenuValue = {
  caps: ContextMenuCapabilities;
  dispatchers: ContextMenuDispatchers;
};

const DesktopContextMenuContext = createContext<DesktopContextMenuValue | null>(null);

export function DesktopContextMenuProvider(props: {
  value: DesktopContextMenuValue;
  children: ReactNode;
}): ReactElement {
  const value = useMemo(
    () => props.value,
    // Value identity is owned by the caller; re-provide only when it changes.
    [props.value],
  );
  return (
    <DesktopContextMenuContext.Provider value={value}>
      {props.children}
    </DesktopContextMenuContext.Provider>
  );
}

/** Null when no provider is mounted (components must fall back gracefully). */
export function useDesktopContextMenu(): DesktopContextMenuValue | null {
  return useContext(DesktopContextMenuContext);
}
