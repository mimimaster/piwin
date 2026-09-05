import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { ThinkingLevel } from '@piwin/contracts';
import type { useMobileHost } from '../../hooks/use-mobile-host.js';

export type InkstoneHost = ReturnType<typeof useMobileHost>;

export interface InkstoneModelSelection {
  providerId: string | undefined;
  modelId: string | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  select: (providerId: string | undefined, modelId: string | undefined) => void;
  selectThinking: (level: ThinkingLevel) => void;
}

export interface InkstoneHostContextValue {
  host: InkstoneHost;
  /** Opens the proven connection surface (credential vault, pairing, errors). */
  onOpenConnection: () => void;
  modelSelection: InkstoneModelSelection;
}

export const InkstoneHostContext = createContext<InkstoneHostContextValue | null>(null);

/** Demo mode has no host; pages read this as null and render prototype data. */

/** Host slice for pages; null unless a Host connection is ready. */
export function useInkstoneHost(): InkstoneHostContextValue | null {
  return useContext(InkstoneHostContext);
}

export function InkstoneHostProvider({
  value,
  children,
}: {
  value: InkstoneHostContextValue | null;
  children: ReactNode;
}): ReactElement {
  return <InkstoneHostContext.Provider value={value}>{children}</InkstoneHostContext.Provider>;
}
