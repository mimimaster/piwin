/**
 * Host diagnostic log ring-buffer. Workbench owns the entries; settings
 * (and any other chrome) reads them so the setter is not a discarded tuple.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { HostLogEntry } from './HostLogPanel';

export type HostLogContextValue = {
  entries: HostLogEntry[];
  onClear: () => void;
};

const HostLogContext = createContext<HostLogContextValue | null>(null);

export function HostLogProvider(props: {
  value: HostLogContextValue;
  children: ReactNode;
}): ReactElement {
  return <HostLogContext.Provider value={props.value}>{props.children}</HostLogContext.Provider>;
}

export function useHostLog(): HostLogContextValue | null {
  return useContext(HostLogContext);
}
