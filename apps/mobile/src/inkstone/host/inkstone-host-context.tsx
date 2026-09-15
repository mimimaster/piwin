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

/** A null context is the intentional offline/demo mode. A non-null context is
 * authoritative even while connecting or recovering, so pages do not invent
 * success states while the Host is unavailable. */
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
