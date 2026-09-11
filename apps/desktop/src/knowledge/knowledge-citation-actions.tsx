import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { KnowledgeCitation } from '@piwin/contracts';

export type KnowledgeCitationActions = {
  openCitation: (citation: KnowledgeCitation) => void;
};

/**
 * Citation markers render deep inside Markdown renderers; a context keeps the
 * open action out of every transcript prop chain.
 */
const KnowledgeCitationActionsContext = createContext<KnowledgeCitationActions | null>(null);

export function KnowledgeCitationActionsProvider(props: {
  value: KnowledgeCitationActions | null;
  children: ReactNode;
}): ReactElement {
  return (
    <KnowledgeCitationActionsContext.Provider value={props.value}>
      {props.children}
    </KnowledgeCitationActionsContext.Provider>
  );
}

export function useKnowledgeCitationActions(): KnowledgeCitationActions | null {
  return useContext(KnowledgeCitationActionsContext);
}
