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
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

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
  /**
   * Alternate conversation view. Both views stay mounted so switching avoids
   * process startup and transcript/composer reconstruction.
   */
  conversationOverride?: ReactNode | undefined;
  conversationOverrideActive?: boolean | undefined;
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
  | 'conversationOverride'
  | 'conversationOverrideActive'
  | 'chatColumnClassName'
>;

function WorkspaceChatColumn(props: WorkspaceChatColumnProps): ReactElement {
  const desktop = useRef<HTMLDivElement | null>(null);
  const previousOverride = useRef(props.conversationOverrideActive === true);
  useEffect(() => {
    const returning = previousOverride.current && props.conversationOverrideActive !== true;
    previousOverride.current = props.conversationOverrideActive === true;
    if (!returning) return;
    const frame = requestAnimationFrame(() => desktop.current?.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [props.conversationOverrideActive]);
  return (
    <section
      className={`chat-column${props.chatColumnClassName !== undefined ? ` ${props.chatColumnClassName}` : ''}`}
    >
      {props.stageHeader}
      {props.sessionContext}
      <div className="chat-stage">
        <div ref={desktop} className="conversation-desktop-surface" hidden={props.conversationOverrideActive === true}>
          {props.transcript}
          {props.activityDock !== undefined ? props.activityDock : null}
          {props.permissionBar !== undefined ? props.permissionBar : null}
          {props.composerDock}
        </div>
        {props.conversationOverride}
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
      conversationOverride={props.conversationOverride}
      conversationOverrideActive={props.conversationOverrideActive}
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
