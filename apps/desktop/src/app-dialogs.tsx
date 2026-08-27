/**
 * Modal stack for workspace trust, rename, session menu, delete, and continue-in-project.
 * Permission prompts are now rendered inline by GateCard in the chat thread
 * (Task 12); the modal branch has been removed.
 */
import type { ReactElement } from 'react';
import type {
  HostOsFamily,
  PermissionDecision,
  PermissionRememberScope,
  ProjectRecord,
} from '@piwin/contracts';
import {
  hostPathStyleFromOsFamily,
  hostWorkspacePathExample,
  looksLikeHostAbsolutePath,
} from '@piwin/contracts';
import { Button, ConfirmDialog, Dialog } from '@piwin/ui-kit';
import { Field } from '@piwin/ui-kit';
import type { ChatUiState } from './chat-reducer';
import { SessionRowMenu, type SessionRowMenuAction } from './session-row-menu';
import { projectDisplayName } from './project-display-name';
import type { DesktopLocale } from './desktop-locale';
import type { SessionNamedDraft, SessionRenameDraft } from './hooks/use-session-list-chrome';

export type AppDialogsProps = {
  projectInput: string;
  onProjectInputChange: (value: string) => void;
  projectPickerOpen: boolean;
  onProjectPickerOpenChange: (open: boolean) => void;
  onOpenProject: (path?: string) => void;
  onBrowseProject: () => void;
  projectPath: string | null;
  trustDialogOpen: boolean;
  onTrustProject: (trust: boolean) => void;
  sessionMenu: { sessionId: string; x: number; y: number } | null;
  onCloseSessionMenu: () => void;
  sessions: ChatUiState['sessions'];
  onSessionMenuAction: (sessionId: string, action: SessionRowMenuAction) => void;
  sessionMenuCanExport?: boolean;
  sessionMenuCanDuplicate?: boolean;
  sessionMenuCanForkChat?: boolean;
  sessionMenuCanContinueInProject?: boolean;
  renameDraft: SessionRenameDraft | null;
  onRenameDraftChange: (draft: SessionRenameDraft | null) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  permissionPrompt: ChatUiState['permissionPrompt'];
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
  deleteConfirm: SessionNamedDraft | null;
  deleteBusy: boolean;
  onDeleteOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  continueInProject: SessionNamedDraft | null;
  continueInProjectBusy: boolean;
  trustedProjects: readonly ProjectRecord[];
  locale: DesktopLocale;
  onContinueInProjectOpenChange: (open: boolean) => void;
  onContinueInProject: (projectPath: string) => void;
  onCancelContinueInProject: () => void;
  /** Remote shells type a Host path; they must not pick a folder from this computer. */
  hostWorkspacePicker?: boolean;
  /** Host OS from hello capabilities. Drives path placeholder and validation. */
  hostOsFamily?: HostOsFamily;
};

export function AppDialogs(props: AppDialogsProps): ReactElement {
  const sessionMenu = props.sessionMenu;
  const menuSession = sessionMenu
    ? props.sessions.find((item) => item.id === sessionMenu.sessionId)
    : undefined;
  const menuStorageState = menuSession?.storage?.state;
  const hostOsFamily = props.hostOsFamily ?? 'other';
  const hostPathStyle = hostPathStyleFromOsFamily(hostOsFamily);
  const hostPathExample = hostWorkspacePathExample(hostOsFamily);
  const hostOsLabel =
    hostOsFamily === 'darwin'
      ? 'macOS'
      : hostOsFamily === 'linux'
        ? 'Linux'
        : hostOsFamily === 'win32'
          ? 'Windows'
          : 'Host';
  const typedHostPath = props.projectInput.trim();
  const hostPathLooksWrong =
    props.hostWorkspacePicker === true &&
    typedHostPath.length > 0 &&
    !looksLikeHostAbsolutePath(typedHostPath, hostPathStyle);
  const isChinese = props.locale === 'zh-CN';

  return (
    <>
      <Dialog
        label="Open workspace"
        open={props.projectPickerOpen}
        onOpenChange={props.onProjectPickerOpenChange}
        testId="workspace-path-dialog"
        closeOnInteractOutside
      >
        <h3>Open workspace</h3>
        <p className="muted">
          {props.hostWorkspacePicker === true
            ? isChinese
              ? `壳连的是 ${hostOsLabel} Host。填那台机器上的绝对路径，不是这台电脑上的文件夹。`
              : `This shell talks to a ${hostOsLabel} Host. Enter an absolute path that exists on that machine, not a folder on this computer.`
            : 'Browser preview cannot open the system folder picker. Enter an absolute path, or run the desktop app for the native chooser.'}
        </p>
        <Field
          label="Workspace path"
          required
          description={
            props.hostWorkspacePicker === true
              ? isChinese
                ? `${hostOsLabel} 路径，例如 ${hostPathExample}`
                : `${hostOsLabel} path, for example ${hostPathExample}`
              : 'Absolute path to a local repository or folder'
          }
        >
          <input
            className="project-path-input"
            data-testid="project-path-input"
            value={props.projectInput}
            onChange={(event) => props.onProjectInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                props.onOpenProject();
              }
            }}
            placeholder={
              props.hostWorkspacePicker === true ? hostPathExample : '/absolute/path/to/repo'
            }
            spellCheck={false}
            autoFocus
          />
        </Field>
        {hostPathLooksWrong ? (
          <p className="muted" data-testid="host-path-style-hint">
            {isChinese
              ? `这台 Host 用的是 ${hostPathStyle === 'windows' ? 'Windows' : 'POSIX'} 路径。`
              : `This Host expects a ${hostPathStyle === 'windows' ? 'Windows' : 'POSIX'} path.`}
          </p>
        ) : null}
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => props.onProjectPickerOpenChange(false)}>
            Cancel
          </Button>
          {props.hostWorkspacePicker === true ? null : (
            <Button onClick={() => props.onBrowseProject()}>Choose folder…</Button>
          )}
          <Button
            variant="primary"
            data-testid="open-project-btn"
            onClick={() => props.onOpenProject()}
          >
            Open
          </Button>
        </div>
      </Dialog>

      {props.trustDialogOpen && props.projectPath ? (
        <Dialog
          label="Trust this project?"
          open
          testId="trust-dialog"
          onOpenChange={(open) => {
            if (!open) {
              props.onTrustProject(false);
            }
          }}
        >
          <h3>Trust this project?</h3>
          <p className="muted">
            Allow the agent to run tools in:
            <br />
            <code>{props.projectPath}</code>
          </p>
          <div className="modal-actions">
            <Button data-testid="trust-deny-btn" onClick={() => props.onTrustProject(false)}>
              Not now
            </Button>
            <Button
              variant="primary"
              data-testid="trust-confirm-btn"
              onClick={() => props.onTrustProject(true)}
            >
              Trust project
            </Button>
          </div>
        </Dialog>
      ) : null}

      {sessionMenu ? (
        <>
          <button
            type="button"
            className="session-menu-backdrop"
            data-testid="session-menu-backdrop"
            aria-label="Close session menu"
            onClick={props.onCloseSessionMenu}
          />
          <SessionRowMenu
            sessionId={sessionMenu.sessionId}
            isPinned={menuSession?.isPinned === true}
            isArchived={menuSession?.isArchived === true}
            {...(menuStorageState ? { storageState: menuStorageState } : {})}
            {...(props.sessionMenuCanExport === false ? { canExport: false } : {})}
            {...(props.sessionMenuCanDuplicate === false ? { canDuplicate: false } : {})}
            {...(props.sessionMenuCanForkChat === false ? { canForkChat: false } : {})}
            {...(props.sessionMenuCanContinueInProject === false
              ? { canContinueInProject: false }
              : {})}
            position={{ x: sessionMenu.x, y: sessionMenu.y }}
            onClose={props.onCloseSessionMenu}
            onAction={(action) => {
              props.onSessionMenuAction(sessionMenu.sessionId, action);
            }}
          />
        </>
      ) : null}

      {props.renameDraft ? (
        <Dialog
          label="Rename agent"
          open
          onOpenChange={(open) => {
            if (!open) {
              props.onRenameDraftChange(null);
            }
          }}
          testId="session-rename-dialog"
        >
          <h3>Rename agent</h3>
          <div className="session-rename-form">
            <Field label="Name" required>
              <input
                id="session-rename-input"
                data-testid="session-rename-input"
                value={props.renameDraft.name}
                autoFocus
                onChange={(event) => {
                  if (!props.renameDraft) {
                    return;
                  }
                  props.onRenameDraftChange({
                    sessionId: props.renameDraft.sessionId,
                    name: event.target.value,
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && props.renameDraft) {
                    event.preventDefault();
                    const draft = props.renameDraft;
                    props.onRenameSession(draft.sessionId, draft.name);
                    props.onRenameDraftChange(null);
                  }
                }}
              />
            </Field>
            <div className="modal-actions">
              <Button onClick={() => props.onRenameDraftChange(null)}>Cancel</Button>
              <Button
                variant="primary"
                data-testid="session-rename-save"
                onClick={() => {
                  if (!props.renameDraft) {
                    return;
                  }
                  const draft = props.renameDraft;
                  props.onRenameSession(draft.sessionId, draft.name);
                  props.onRenameDraftChange(null);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      <Dialog
        label={props.locale === 'zh-CN' ? '继续到项目' : 'Continue in project'}
        open={props.continueInProject !== null}
        onOpenChange={props.onContinueInProjectOpenChange}
        testId="continue-session-in-project-dialog"
      >
        <h3>{props.locale === 'zh-CN' ? '选择目标项目' : 'Choose a project'}</h3>
        <p className="muted">
          {props.locale === 'zh-CN'
            ? `将“${props.continueInProject?.sessionName ?? ''}”的完整历史复制到项目会话；原会话会保留。`
            : `Copy the full history of “${props.continueInProject?.sessionName ?? ''}” into a project session. The original remains unchanged.`}
        </p>
        <div className="continue-session-project-list">
          {props.trustedProjects.length > 0 ? (
            props.trustedProjects.map((project) => (
              <Button
                key={project.path}
                disabled={props.continueInProjectBusy}
                data-testid="continue-session-project-option"
                onClick={() => props.onContinueInProject(project.path)}
              >
                {projectDisplayName(project.path)}
              </Button>
            ))
          ) : (
            <p className="muted">
              {props.locale === 'zh-CN'
                ? '请先打开并信任一个项目。'
                : 'Open and trust a project first.'}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <Button
            variant="ghost"
            disabled={props.continueInProjectBusy}
            onClick={props.onCancelContinueInProject}
          >
            {props.locale === 'zh-CN' ? '取消' : 'Cancel'}
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(props.deleteConfirm)}
        onOpenChange={props.onDeleteOpenChange}
        title="Delete permanently?"
        description="Transcript files will be removed. This cannot be undone."
        {...(props.deleteConfirm?.sessionName
          ? { affectedObject: props.deleteConfirm.sessionName }
          : {})}
        confirmLabel="Delete permanently"
        tone="danger"
        busy={props.deleteBusy}
        testId="session-delete-confirm"
        onConfirm={props.onConfirmDelete}
      />
    </>
  );
}
