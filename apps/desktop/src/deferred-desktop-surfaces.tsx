import { lazy, Suspense, type ReactElement, type ReactNode } from 'react';
import { Spinner } from '@piwin/ui-kit';

export const DeferredSettingsPanel = lazy(async () => {
  const module = await import('./SettingsPanel');
  return { default: module.SettingsPanel };
});

export const DeferredKnowledgeCenterPanel = lazy(async () => {
  const module = await import('./KnowledgeCenterPanel');
  return { default: module.KnowledgeCenterPanel };
});

export const DeferredFileTreePanel = lazy(async () => {
  const module = await import('./file-tree-panel');
  return { default: module.FileTreePanel };
});

export const DeferredNotesPanel = lazy(async () => {
  const module = await import('./NotesPanel');
  return { default: module.NotesPanel };
});

export const DeferredFlashcardsPanel = lazy(async () => {
  const module = await import('./FlashcardsPanel');
  return { default: module.FlashcardsPanel };
});

export const DeferredCanvasPanel = lazy(async () => {
  const module = await import('./canvas-panel');
  return { default: module.CanvasPanel };
});

export const DeferredBrowserSessionPanel = lazy(async () => {
  const module = await import('./browser-session-panel');
  return { default: module.BrowserSessionPanel };
});

export const DeferredSideChatPanel = lazy(async () => {
  const module = await import('./side-chat-panel');
  return { default: module.SideChatPanel };
});

export const DeferredDocPreviewPanel = lazy(async () => {
  const module = await import('./DocPreviewPanel');
  return { default: module.DocPreviewPanel };
});

export const DeferredTerminalDock = lazy(async () => {
  const module = await import('./terminal-dock');
  return { default: module.TerminalDock };
});

export const DeferredReviewPanel = lazy(async () => {
  const module = await import('./review-panel');
  return { default: module.ReviewPanel };
});

export const DeferredChangesPanel = lazy(async () => {
  const module = await import('./changes-panel');
  return { default: module.ChangesPanel };
});

export const DeferredGitPanel = lazy(async () => {
  const module = await import('./GitPanel');
  return { default: module.GitPanel };
});

export const DeferredSubagentSessionDialog = lazy(async () => {
  const module = await import('./subagent-session-dialog');
  return { default: module.SubagentSessionDialog };
});

export type DeferredSurfaceBoundaryProps = {
  children: ReactNode;
  label: string;
};

/** Keep a deferred feature load from suspending the surrounding shell. */
export function DeferredSurfaceBoundary(props: DeferredSurfaceBoundaryProps): ReactElement {
  return (
    <Suspense
      fallback={
        <div className="deferred-surface-fallback" data-testid="deferred-surface-fallback">
          <Spinner label={props.label} />
        </div>
      }
    >
      {props.children}
    </Suspense>
  );
}
