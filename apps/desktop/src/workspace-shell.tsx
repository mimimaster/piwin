/**
 * WorkspaceShell — pure layout component for the three-column, four-band shell.
 *
 * Accepts slot content only. Owns no state, effects, refs, or event handlers.
 * All host wiring and state remain in App.tsx.
 *
 * Band structure (top to bottom):
 *   1. Titleband (40px)   — WorkspaceTitlebar, rendered outside this component
 *   2. Context bar (42px) — contextBar slot
 *   3. Stage content      — shared .chat-stage column (transcript + permission + composer)
 *   4. Status bar (26px)  — statusBar slot
 *   5. Knowledge overlay  — optional full-stage panel (e.g. Knowledge Center)
 *
 * Column structure (left to right):
 *   - Sidebar (collapsible, ~236px)
 *   - Stage (content; message + composer share --chat-max)
 *   - Right panel / inspector (outward-expanding, optional)
 */
import type { ReactElement, ReactNode } from 'react';

export type WorkspaceShellProps = {
  sidebar: ReactNode;
  contextBar: ReactNode;
  transcript: ReactNode;
  /** Optional compact subagent activity dock — sits between transcript and permission bar. */
  activityDock?: ReactNode | undefined;
  /** Docked permission bar (ADR 0024) — sits between transcript and composer. */
  permissionBar?: ReactNode | undefined;
  composerDock: ReactNode;
  statusBar: ReactNode;
  rightPanel: ReactNode;
  /** Optional full-stage panel (e.g. Knowledge Center). */
  knowledgePanel?: ReactNode | undefined;
  /** Applied as className additions to the .workspace container. */
  workspaceClassName?: string | undefined;
  /** Layout-dependent class for the chat-column (e.g. centered when empty). */
  chatColumnClassName?: string | undefined;
};

export function WorkspaceShell(props: WorkspaceShellProps): ReactElement {
  return (
    <>
      {props.sidebar}
      <div
        className={`workspace${props.workspaceClassName !== undefined ? ` ${props.workspaceClassName}` : ''}`}
      >
        <section
          className={`chat-column${props.chatColumnClassName !== undefined ? ` ${props.chatColumnClassName}` : ''}`}
        >
          {props.contextBar}
          <div className="chat-stage">
            {props.transcript}
            {props.activityDock !== undefined ? props.activityDock : null}
            {props.permissionBar !== undefined ? props.permissionBar : null}
            {props.composerDock}
          </div>
          {props.statusBar}
        </section>
        {props.knowledgePanel !== undefined ? props.knowledgePanel : null}
      </div>
      {props.rightPanel}
    </>
  );
}
