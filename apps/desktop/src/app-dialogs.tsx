/**
 * Modal stack for workspace trust, extension UI, rename, session menu.
 * Permission prompts are now rendered inline by GateCard in the chat thread
 * (Task 12); the modal branch has been removed.
 */
import type { ReactElement } from 'react';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';
import { Button, Dialog } from '@piwin/ui-kit';
import { Field } from '@piwin/ui-kit';
import type { ChatUiState } from './chat-reducer';
import type { ExtensionUiRequestState } from './hooks/use-host-bootstrap';
import { SessionRowMenu, type SessionRowMenuAction } from './session-row-menu';

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
  extensionUiRequest: ExtensionUiRequestState | null;
  extensionUiInput: string;
  onExtensionUiInputChange: (value: string) => void;
  onExtensionUiResolve: (payload: {
    confirmed?: boolean;
    value?: string;
    cancelled?: boolean;
  }) => void;
  sessionMenu: { sessionId: string; x: number; y: number } | null;
  onCloseSessionMenu: () => void;
  sessions: ChatUiState['sessions'];
  showArchivedSessions: boolean;
  onSessionMenuAction: (sessionId: string, action: SessionRowMenuAction) => void;
  renameDraft: { sessionId: string; name: string } | null;
  onRenameDraftChange: (draft: { sessionId: string; name: string } | null) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  permissionPrompt: ChatUiState['permissionPrompt'];
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
};

export function AppDialogs(props: AppDialogsProps): ReactElement {
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
          Browser preview cannot open the system folder picker. Enter an absolute path, or run the
          desktop app for the native chooser.
        </p>
        <Field
          label="Workspace path"
          required
          description="Absolute path to a local repository or folder"
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
            placeholder="/absolute/path/to/repo"
            spellCheck={false}
            autoFocus
          />
        </Field>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => props.onProjectPickerOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => props.onBrowseProject()}>Choose folder…</Button>
          <Button
            variant="primary"
            data-testid="open-project-btn"
            onClick={() => props.onOpenProject()}
          >
            Open
          </Button>
        </div>
      </Dialog>

      {props.trustDialogOpen ? (
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

      {props.extensionUiRequest ? (
        <Dialog
          label={props.extensionUiRequest.title}
          open
          testId="extension-ui-dialog"
          onOpenChange={(open) => {
            if (!open) {
              props.onExtensionUiResolve({ cancelled: true, confirmed: false });
            }
          }}
        >
          <h3>{props.extensionUiRequest.title}</h3>
          {props.extensionUiRequest.message ? (
            <pre className="permission-detail">{props.extensionUiRequest.message}</pre>
          ) : null}
          <p className="muted">Extension UI ({props.extensionUiRequest.kind})</p>
          {props.extensionUiRequest.kind === 'input' ? (
            <Field label="Response">
              <input
                data-testid="extension-ui-input"
                value={props.extensionUiInput}
                placeholder={props.extensionUiRequest.placeholder ?? ''}
                onChange={(event) => props.onExtensionUiInputChange(event.target.value)}
              />
            </Field>
          ) : null}
          {props.extensionUiRequest.kind === 'select' ? (
            <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
              {(props.extensionUiRequest.options ?? []).map((option) => (
                <Button
                  key={option}
                  data-testid="extension-ui-option"
                  onClick={() => props.onExtensionUiResolve({ value: option })}
                >
                  {option}
                </Button>
              ))}
              <Button onClick={() => props.onExtensionUiResolve({ cancelled: true })}>
                Cancel
              </Button>
            </div>
          ) : null}
          {props.extensionUiRequest.kind === 'confirm' ? (
            <div className="modal-actions">
              <Button
                data-testid="extension-ui-deny"
                onClick={() => props.onExtensionUiResolve({ confirmed: false })}
              >
                Deny
              </Button>
              <Button
                variant="primary"
                data-testid="extension-ui-allow"
                onClick={() => props.onExtensionUiResolve({ confirmed: true })}
              >
                Allow
              </Button>
            </div>
          ) : null}
          {props.extensionUiRequest.kind === 'input' ? (
            <div className="modal-actions">
              <Button onClick={() => props.onExtensionUiResolve({ cancelled: true })}>
                Cancel
              </Button>
              <Button
                variant="primary"
                data-testid="extension-ui-submit"
                onClick={() => props.onExtensionUiResolve({ value: props.extensionUiInput })}
              >
                Submit
              </Button>
            </div>
          ) : null}
        </Dialog>
      ) : null}

      {props.sessionMenu ? (
        <>
          <button
            type="button"
            className="session-menu-backdrop"
            data-testid="session-menu-backdrop"
            aria-label="Close session menu"
            onClick={props.onCloseSessionMenu}
          />
          <SessionRowMenu
            sessionId={props.sessionMenu.sessionId}
            isPinned={
              props.sessions.find((item) => item.id === props.sessionMenu?.sessionId)?.isPinned ===
              true
            }
            isArchived={
              props.sessions.find((item) => item.id === props.sessionMenu?.sessionId)
                ?.isArchived === true || props.showArchivedSessions
            }
            position={{ x: props.sessionMenu.x, y: props.sessionMenu.y }}
            onClose={props.onCloseSessionMenu}
            onAction={(action) => {
              if (props.sessionMenu) {
                props.onSessionMenuAction(props.sessionMenu.sessionId, action);
              }
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
    </>
  );
}
