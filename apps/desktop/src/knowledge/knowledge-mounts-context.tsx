import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { KnowledgeBaseSummary } from '@piwin/contracts';

export type KnowledgeMountsValue = {
  /** Host exposes `knowledge/*`; composer surfaces stay hidden otherwise. */
  supported: boolean;
  bases: readonly KnowledgeBaseSummary[];
  /** Bases the active conversation (or the unsent draft) uses. */
  mountedIds: readonly string[];
  error: string | null;
  toggle: (baseId: string) => void;
  mount: (baseId: string) => void;
  openManager: () => void;
};

/** Composer "+" menu and chips read mounts here instead of through the composer prop chain. */
const KnowledgeMountsContext = createContext<KnowledgeMountsValue | null>(null);

export function KnowledgeMountsProvider(props: {
  value: KnowledgeMountsValue | null;
  children: ReactNode;
}): ReactElement {
  return (
    <KnowledgeMountsContext.Provider value={props.value}>{props.children}</KnowledgeMountsContext.Provider>
  );
}

export function useKnowledgeMounts(): KnowledgeMountsValue | null {
  return useContext(KnowledgeMountsContext);
}
