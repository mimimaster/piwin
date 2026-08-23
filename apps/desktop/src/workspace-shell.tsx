/**
 * WorkspaceShell — pure layout for the three-column product shell.
 *
 * No full-window topbar. Chrome (nav controls, title, tools) lives in the
 * stage column only via the contextBar slot.
 *
 * Columns (left → right):
 *   - Sidebar (collapsible)
 *   - Stage: contextBar + transcript/permission/composer + statusBar
 *   - Right panel / inspector (optional)
 */
import type { ReactElement, ReactNode } from 'react';

export type WorkspaceShellProps = {
  sidebar: ReactNode;
  /** Stage-local chrome: sidebar toggle, history, title, right tools. */
  contextBar: ReactNode;
  transcript: ReactNode;
  activityDock?: ReactNode | undefined;
  permissionBar?: ReactNode | undefined;
  composerDock: ReactNode;
  statusBar: ReactNode;
  rightPanel: ReactNode;
  workspaceClassName?: string | undefined;
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
      </div>
      {props.rightPanel}
    </>
  );
}
