/**
 * WorkspaceShell — pure layout for the product shell.
 *
 * The titlebar is a full-window row above the deck, not a panel child. macOS
 * pins the Overlay traffic lights to a fixed offset from the *window* top, so
 * the only row that can share their line is one flush with the window top.
 * Panels start below it and keep the deck inset.
 *
 * Rows / columns:
 *   - Titlebar: window controls, history, title, right tools (spans all columns)
 *   - Sidebar (collapsible) | Stage (transcript/permission/composer/statusBar)
 *     | Right panel / inspector (optional)
 */
import type { ReactElement, ReactNode } from 'react';

export type WorkspaceShellProps = {
  sidebar: ReactNode;
  /** Full-window titlebar: window controls, history, title, right tools. */
  titlebar: ReactNode;
  transcript: ReactNode;
  activityDock?: ReactNode | undefined;
  permissionBar?: ReactNode | undefined;
  composerDock: ReactNode;
  statusBar: ReactNode;
  rightPanel: ReactNode;
  workspaceClassName?: string | undefined;
  chatColumnClassName?: string | undefined;
  /** Conversation-only shell wrapper (for example the device-local pane tree). */
  renderStage?: ((primaryChatColumn: ReactElement) => ReactNode) | undefined;
};

type WorkspaceChatColumnProps = Pick<
  WorkspaceShellProps,
  | 'transcript'
  | 'activityDock'
  | 'permissionBar'
  | 'composerDock'
  | 'statusBar'
  | 'chatColumnClassName'
>;

function WorkspaceChatColumn(props: WorkspaceChatColumnProps): ReactElement {
  return (
    <section
      className={`chat-column${props.chatColumnClassName !== undefined ? ` ${props.chatColumnClassName}` : ''}`}
    >
      <div className="chat-stage">
        {props.transcript}
        {props.activityDock !== undefined ? props.activityDock : null}
        {props.permissionBar !== undefined ? props.permissionBar : null}
        {props.composerDock}
        {props.statusBar}
      </div>
    </section>
  );
}

export function WorkspaceShell(props: WorkspaceShellProps): ReactElement {
  const primaryChatColumn = (
    <WorkspaceChatColumn
      transcript={props.transcript}
      activityDock={props.activityDock}
      permissionBar={props.permissionBar}
      composerDock={props.composerDock}
      statusBar={props.statusBar}
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
