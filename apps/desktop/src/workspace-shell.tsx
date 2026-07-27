/**
 * WorkspaceShell — pure layout component for the three-column, four-band shell.
 *
 * Accepts slot content only. Owns no state, effects, refs, or event handlers.
 * All host wiring and state remain in App.tsx.
 *
 * Band structure (top to bottom):
 *   1. Titleband (40px)   — WorkspaceTitlebar, rendered outside this component
 *   2. Context bar (42px) — contextBar slot
 *   3. Stage content      — transcript + composerDock in chat-column
 *   4. Status bar (26px)  — statusBar slot
 *
 * Column structure (left to right):
 *   - Sidebar (collapsible, ~236px)
 *   - Stage (content, max-width 640px)
 *   - Right panel / inspector (outward-expanding, optional)
 */
import type { ReactElement, ReactNode } from 'react';

export type WorkspaceShellProps = {
  sidebar: ReactNode;
  contextBar: ReactNode;
  transcript: ReactNode;
  composerDock: ReactNode;
  statusBar: ReactNode;
  rightPanel: ReactNode;
  /** Applied as className additions to the .workspace container. */
  workspaceClassName?: string | undefined;
  /** Layout-dependent class for the chat-column (e.g. centered when empty). */
  chatColumnClassName?: string | undefined;
};

export function WorkspaceShell(props: WorkspaceShellProps): ReactElement {
  return (
    <>
      {props.sidebar}
      <div className={`workspace${props.workspaceClassName !== undefined ? ` ${props.workspaceClassName}` : ''}`}>
        <section className={`chat-column${props.chatColumnClassName !== undefined ? ` ${props.chatColumnClassName}` : ''}`}>
          {props.contextBar}
          {props.transcript}
          {props.composerDock}
          {props.statusBar}
        </section>
      </div>
      {props.rightPanel}
    </>
  );
}
