import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { MarkdownRenderingPhase } from './markdown-code-fence.js';

const MarkdownRenderingPhaseContext = createContext<MarkdownRenderingPhase>('completed');

export function MarkdownRenderingPhaseProvider(props: {
  phase: MarkdownRenderingPhase;
  children: ReactNode;
}): ReactElement {
  return (
    <MarkdownRenderingPhaseContext.Provider value={props.phase}>
      {props.children}
    </MarkdownRenderingPhaseContext.Provider>
  );
}

export function useMarkdownRenderingPhase(): MarkdownRenderingPhase {
  return useContext(MarkdownRenderingPhaseContext);
}
