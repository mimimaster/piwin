/**
 * WorkspaceShell — pure layout for the product shell.
 *
 * The titlebar overlays the deck's top strip; under the Inkstone themes it is
 * confined to the stage column (proto-00-shell.html 00.2), where each column
 * owns its own 42px header strip.
 *
 * Rows / columns:
 *   - Titlebar: window controls, history, title, right tools
 *   - Sidebar (collapsible) | Stage (header + transcript/permission/
 *     composer) | Right panel / inspector (optional)
 *   Inkstone parks project/branch chips in the stage header trailing slot
 *   (no separate session-context row) so the transcript keeps height.
 */
import type { ReactElement, ReactNode } from 'react';

export type WorkspaceShellProps = {
  sidebar: ReactNode;
  /** Full-window titlebar: window controls, history, title, right tools. */
  titlebar: ReactNode;
  /** Stage-top header (42px) in Inkstone themes: session title, lamp, sq, tree. */
  stageHeader?: ReactNode | undefined;
  /** Stage-top context line (project / branch / path) for project sessions. */
  sessionContext?: ReactNode;
  transcript: ReactNode;
  activityDock?: ReactNode | undefined;
  permissionBar?: ReactNode | undefined;
  composerDock: ReactNode;
  rightPanel: ReactNode;
  workspaceClassName?: string | undefined;
  chatColumnClassName?: string | undefined;
  /** Conversation-only shell wrapper (for example the device-local pane tree). */
  renderStage?: ((primaryChatColumn: ReactElement) => ReactNode) | undefined;
};

type WorkspaceChatColumnProps = Pick<
  WorkspaceShellProps,
  | 'stageHeader'
  | 'sessionContext'
  | 'transcript'
  | 'activityDock'
  | 'permissionBar'
  | 'composerDock'
  | 'chatColumnClassName'
>;

function WorkspaceChatColumn(props: WorkspaceChatColumnProps): ReactElement {
  return (
    <section
      className={`chat-column${props.chatColumnClassName !== undefined ? ` ${props.chatColumnClassName}` : ''}`}
    >
      {props.stageHeader}
      {props.sessionContext}
      <div className="chat-stage">
        {props.transcript}
        {props.activityDock !== undefined ? props.activityDock : null}
        {props.permissionBar !== undefined ? props.permissionBar : null}
        {props.composerDock}
      </div>
    </section>
  );
}

export function WorkspaceShell(props: WorkspaceShellProps): ReactElement {
  const primaryChatColumn = (
    <WorkspaceChatColumn
      stageHeader={props.stageHeader}
      sessionContext={props.sessionContext}
      transcript={props.transcript}
      activityDock={props.activityDock}
      permissionBar={props.permissionBar}
      composerDock={props.composerDock}
      chatColumnClassName={props.chatColumnClassName}
    />
  );
  return (
    <>
      {props.titlebar}
      {props.sidebar}
      <div
        className={`workspace${props.workspaceClassName !== undefined ? ` ${props.workspaceClassName}` : ''}`}
      >
        {props.renderStage ? props.renderStage(primaryChatColumn) : primaryChatColumn}
      </div>
      {props.rightPanel}
    </>
  );
}
