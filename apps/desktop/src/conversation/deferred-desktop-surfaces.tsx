import { lazy, Suspense, type ReactElement, type ReactNode } from 'react';
import { Spinner } from '@piwin/ui-kit';

type SettingsPanelComponent = typeof import('../settings/SettingsPanel').SettingsPanel;

/** Set once the chunk has loaded; later opens render it without suspending. */
let loadedSettingsPanel: SettingsPanelComponent | null = null;

/** Same specifier as React.lazy so Vite/Rollup emit one SettingsPanel chunk. */
function loadSettingsPanel(): Promise<{ default: SettingsPanelComponent }> {
  return import('../settings/SettingsPanel').then((module) => {
    loadedSettingsPanel = module.SettingsPanel;
    return { default: module.SettingsPanel };
  });
}

/**
 * The panel itself once loaded (idle prefetch usually does this at start-up).
 * A fresh lazy() per open would suspend for a frame every time even so.
 */
export function getLoadedSettingsPanel(): SettingsPanelComponent | null {
  return loadedSettingsPanel;
}

export const DeferredSettingsPanel = lazy(loadSettingsPanel);

/** Fresh lazy() so a failed chunk load is retryable. React.lazy caches rejection. */
export function createDeferredSettingsPanel(): typeof DeferredSettingsPanel {
  return lazy(loadSettingsPanel);
}

/** Chromium-style warm of the Basic settings document before the click. */
export function prefetchSettingsPanel(): Promise<unknown> {
  return loadSettingsPanel();
}

export const DeferredFileTreePanel = lazy(async () => {
  const module = await import('../files/file-tree-panel');
  return { default: module.FileTreePanel };
});

export const DeferredNotesPanel = lazy(async () => {
  const module = await import('../notes/NotesPanel');
  return { default: module.NotesPanel };
});

export const DeferredFlashcardsPanel = lazy(async () => {
  const module = await import('../flashcards/FlashcardsPanel');
  return { default: module.FlashcardsPanel };
});

export const DeferredBrowserSessionPanel = lazy(async () => {
  const module = await import('../browser/browser-session-panel');
  return { default: module.BrowserSessionPanel };
});

export const DeferredSideChatPanel = lazy(async () => {
  const module = await import('../session/side-chat-panel');
  return { default: module.SideChatPanel };
});

export const DeferredDocPreviewPanel = lazy(async () => {
  const module = await import('../documents/DocPreviewPanel');
  return { default: module.DocPreviewPanel };
});

export const DeferredMediaDocPreview = lazy(async () => {
  const module = await import('../media/MediaDocPreview');
  return { default: module.MediaDocPreview };
});

export const DeferredTerminalDock = lazy(async () => {
  const module = await import('../terminal/terminal-dock');
  return { default: module.TerminalDock };
});

function loadTuiPane(): Promise<{ default: typeof import('../terminal/tui-pane').TuiPane }> {
  return import('../terminal/tui-pane').then((module) => ({ default: module.TuiPane }));
}

export const DeferredTuiPane = lazy(loadTuiPane);

/** Warm the renderer on intent without starting a process or creating a session. */
export function prefetchTuiPane(): Promise<unknown> { return loadTuiPane(); }

export const DeferredChangesPanel = lazy(async () => {
  const module = await import('../turn-changes/changes-panel');
  return { default: module.ChangesPanel };
});

export const DeferredGitPanel = lazy(async () => {
  const module = await import('../git/GitPanel');
  return { default: module.GitPanel };
});

export const DeferredLibraryWorkspaceView = lazy(async () => {
  const module = await import('../workspace-subpages/LibraryWorkspaceView.js');
  return { default: module.LibraryWorkspaceView };
});

export const DeferredKnowledgeWorkspaceView = lazy(async () => {
  const module = await import('../workspace-subpages/KnowledgeWorkspaceView.js');
  return { default: module.KnowledgeWorkspaceView };
});

export const DeferredMarketplaceWorkspaceView = lazy(async () => {
  const module = await import('../workspace-subpages/MarketplaceWorkspaceView.js');
  return { default: module.MarketplaceWorkspaceView };
});

export type DeferredSurfaceBoundaryProps = {
  children: ReactNode;
  label: string;
  /** The surface's own frame while it loads; defaults to a centered spinner. */
  fallback?: ReactNode;
};

/** Keep a deferred feature load from suspending the surrounding shell. */
export function DeferredSurfaceBoundary(props: DeferredSurfaceBoundaryProps): ReactElement {
  return (
    <Suspense
      fallback={
        props.fallback ?? (
          <div className="deferred-surface-fallback" data-testid="deferred-surface-fallback">
            <Spinner label={props.label} />
          </div>
        )
      }
    >
      {props.children}
    </Suspense>
  );
}
