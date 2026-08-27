import { lazy, Suspense, type ReactElement, type ReactNode } from 'react';
import { Spinner } from '@piwin/ui-kit';

/** Same specifier as React.lazy so Vite/Rollup emit one SettingsPanel chunk. */
function loadSettingsPanel(): Promise<{ default: typeof import('./SettingsPanel').SettingsPanel }> {
  return import('./SettingsPanel').then((module) => ({ default: module.SettingsPanel }));
}

export const DeferredSettingsPanel = lazy(loadSettingsPanel);

/** Chromium-style warm of the Basic settings document before the click. */
export function prefetchSettingsPanel(): Promise<unknown> {
  return loadSettingsPanel();
}

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

export const DeferredMediaDocPreview = lazy(async () => {
  const module = await import('./MediaDocPreview');
  return { default: module.MediaDocPreview };
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
