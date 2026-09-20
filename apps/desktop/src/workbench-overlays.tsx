/**
 * Modal stack + settings overlay of the desktop workbench (extracted from App).
 * Host commands stay with App; this file owns dialog/settings chrome.
 */
import {
  Component,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Button, Notice } from '@piwin/ui-kit';
import type { PetPanelProps } from './PetPanel';
import type {
  HostListDirData,
  HostStatusData,
  PermissionDecision,
  PermissionRememberScope,
  PiwinConfig,
  ProjectRecord,
  SessionScope,
  SessionStorageInfo,
  ThemeManifest,
  WorkspaceWrites,
} from '@piwin/contracts';

import { AppDialogs } from './app-dialogs';
import { BranchSwitchConfirmDialog } from './branch-switch-confirm-dialog';
import { CommandPalette } from './command-palette';
import type { ChatUiState, SessionListItemUi } from './chat-reducer';
import type { DesktopCommandId } from './desktop-commands';
import type { DesktopLocale } from './desktop-locale';
import {
  createDeferredSettingsPanel,
  DeferredSurfaceBoundary,
  prefetchSettingsPanel,
} from './deferred-desktop-surfaces';
import { scheduleIdleTask } from './schedule-idle-task';
import type { HostClient } from './host-client';
import type { HostRequestAdapters } from './host-request-adapters';
import {
  routeSessionChromeMenuAction,
  type SessionNamedDraft,
  type SessionRenameDraft,
} from './hooks/use-session-list-chrome';
import { collectSessionsForLookup } from './session-list-lookup';
import { SessionColdRestoreDialog } from './session-cold-restore-dialog';
import { SessionSearchDialog } from './session-search-dialog';
import type { SessionRowMenuAction } from './session-row-menu';
import type { SettingsSectionId } from './settings/section-registry';
import { TruncateAfterDialog } from './truncate-after-dialog';
import type { DesktopPreferences } from './ui-preferences';

export type WorkbenchOverlaysProps = {
  state: ChatUiState;
  hostClient: HostClient;
  locale: DesktopLocale;
  projectInput: string;
  setProjectInput: Dispatch<SetStateAction<string>>;
  projectPickerOpen: boolean;
  setProjectPickerOpen: Dispatch<SetStateAction<boolean>>;
  onOpenProject: (path: string) => void | Promise<void>;
  onBrowseProject: () => void | Promise<void>;
  onTrustProject: (trust: boolean) => void | Promise<void>;
  sessionMenu: { sessionId: string; x: number; y: number } | null;
  closeSessionMenu: () => void;
  onSessionMenuAction: (sessionId: string, action: SessionRowMenuAction) => void | Promise<void>;
  requestDeleteSession: (sessionId: string, sessionName: string) => void;
  requestContinueInProject: (sessionId: string, sessionName: string) => void;
  renameDraft: SessionRenameDraft | null;
  setRenameDraft: Dispatch<SetStateAction<SessionRenameDraft | null>>;
  onRenameSession: (sessionId: string, name: string) => void | Promise<void>;
  onPermission: (
    decision: PermissionDecision,
    scope?: PermissionRememberScope,
  ) => void | Promise<void>;
  deleteConfirm: SessionNamedDraft | null;
  deleteBusy: boolean;
  closeDeleteConfirm: () => void;
  runDeleteConfirm: (deleteSession: (sessionId: string) => Promise<unknown>) => void;
  confirmDeleteSession: (sessionId: string) => Promise<unknown>;
  continueInProject: SessionNamedDraft | null;
  continueInProjectBusy: boolean;
  closeContinueInProject: () => void;
  runContinueInProject: (
    targetScope: SessionScope,
    continueSession: (sessionId: string, targetScope: SessionScope) => Promise<boolean>,
  ) => void;
  onContinueSessionInProject: (sessionId: string, targetScope: SessionScope) => Promise<boolean>;
  recentProjects: readonly ProjectRecord[];
  sessionSearchOpen: boolean;
  onSessionSearchOpenChange: (open: boolean) => void;
  sessionSearch: string;
  onSessionSearchChange: (query: string) => void;
  filteredSessions: readonly SessionListItemUi[];
  filteredGeneralSessions: readonly SessionListItemUi[];
  onOpenSession: (sessionId: string, context: { scope: SessionScope }) => void | Promise<void>;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  onRunCommand: (commandId: DesktopCommandId) => void;
  coldRestorePrompt: { sessionId: string; storage: SessionStorageInfo } | null;
  clearColdRestorePrompt: () => void;
  confirmColdRestore: (packPath?: string) => void | Promise<void>;
  pendingTruncate: { messageId: string } | null;
  cancelTruncateAfter: () => void;
  confirmTruncateAfter: () => void | Promise<void>;
  pendingSwitchConfirm: { targetMessageId: string; offPathWrites: WorkspaceWrites } | null;
  cancelSwitchBranch: () => void;
  confirmSwitchBranch: () => void;
  stashThenSwitchBranch?: () => void;
  pendingRetryDiscard: { userMessageId: string; offPathWrites: WorkspaceWrites } | null;
  cancelRetryDiscard: () => void;
  confirmRetryDiscard: () => void;
  pendingBranchLeaves: { messageId: string; offPathWrites: WorkspaceWrites } | null;
  cancelBranchLeaves: () => void;
  confirmBranchLeaves: () => void;
};

export type WorkbenchSettingsOverlayProps = {
  settingsOpen: boolean;
  locale: DesktopLocale;
  hostStatus: HostStatusData | null;
  hostClient: HostClient;
  requestConfig: HostRequestAdapters['requestConfig'];
  preferences: DesktopPreferences;
  activeTheme: ThemeManifest;
  onPreferencesChange: (next: DesktopPreferences) => void;
  settingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  state: ChatUiState;
  requestSkills: HostRequestAdapters['requestSkills'];
  requestMcp: HostRequestAdapters['requestMcp'];
  requestExtensions: HostRequestAdapters['requestExtensions'];
  requestPlugins: HostRequestAdapters['requestPlugins'];
  requestPrompts: HostRequestAdapters['requestPrompts'];
  requestPet: HostRequestAdapters['requestPet'];
  requestAutomation: HostRequestAdapters['requestAutomation'];
  requestSubAgent: HostRequestAdapters['requestSubAgent'];
  onOpenSubagentSession: (sessionId: string) => void;
  onThemeApplied: (theme: ThemeManifest) => void;
  onPetActiveChanged: PetPanelProps['onActiveChanged'];
  onCloseSettings: () => void;
  onSettingsSaved: (next: PiwinConfig) => void;
  config: PiwinConfig | null;
};

export function WorkbenchOverlays(props: WorkbenchOverlaysProps): ReactElement {
  useEffect(() => {
    return scheduleIdleTask(() => {
      void prefetchSettingsPanel();
    });
  }, []);
  const sessions = collectSessionsForLookup({
    sessions: props.state.sessions,
    generalSessions: props.state.generalSessions,
    projectSessionsByPath: props.state.projectSessionsByPath,
  });
  const hostOsFamily = props.hostClient.getRemoteCapabilities()?.platform;
  return (
    <>
      <AppDialogs
        projectInput={props.projectInput}
        onProjectInputChange={props.setProjectInput}
        projectPickerOpen={props.projectPickerOpen}
        onProjectPickerOpenChange={props.setProjectPickerOpen}
        onOpenProject={(path) => {
          const requestedPath = path?.trim() || props.projectInput.trim();
          if (requestedPath) {
            void props.onOpenProject(requestedPath);
          }
        }}
        onBrowseProject={() => void props.onBrowseProject()}
        {...(props.hostClient.supportsCommand('host/list-dir')
          ? {
              hostWorkspacePicker: true,
              ...(hostOsFamily === undefined ? {} : { hostOsFamily }),
              onListHostDirectory: async (path?: string): Promise<HostListDirData> => {
                const response = await props.hostClient.request({
                  type: 'host/list-dir',
                  ...(path && path.trim().length > 0 ? { path: path.trim() } : {}),
                });
                if (!response.success) {
                  throw new Error(response.error);
                }
                return response.data as HostListDirData;
              },
            }
          : {})}
        projectPath={props.state.projectPath}
        trustDialogOpen={props.state.trustDialogOpen}
        onTrustProject={(trust) => void props.onTrustProject(trust)}
        sessionMenu={props.sessionMenu}
        onCloseSessionMenu={props.closeSessionMenu}
        sessions={sessions}
        onSessionMenuAction={(sessionId, action) => {
          routeSessionChromeMenuAction({
            sessionId,
            action,
            sessions,
            requestDelete: props.requestDeleteSession,
            requestContinueInProject: props.requestContinueInProject,
            handleHostMenuAction: (nextSessionId, nextAction) => {
              void props.onSessionMenuAction(nextSessionId, nextAction);
            },
          });
        }}
        {...(props.hostClient.supportsCommand('session/export')
          ? {}
          : { sessionMenuCanExport: false })}
        {...(props.hostClient.supportsCommand('session/duplicate')
          ? {}
          : { sessionMenuCanDuplicate: false })}
        {...(props.hostClient.supportsCommand('session/fork')
          ? {}
          : { sessionMenuCanForkChat: false })}
        {...(props.hostClient.supportsCommand('session/duplicate')
          ? {}
          : { sessionMenuCanContinueInProject: false })}
        renameDraft={props.renameDraft}
        onRenameDraftChange={props.setRenameDraft}
        onRenameSession={(sessionId, name) => {
          void props.onRenameSession(sessionId, name);
        }}
        permissionPrompt={props.state.permissionPrompt}
        onPermission={(decision, scope) => {
          void props.onPermission(decision, scope);
        }}
        deleteConfirm={props.deleteConfirm}
        deleteBusy={props.deleteBusy}
        onDeleteOpenChange={(open) => {
          if (!open) {
            props.closeDeleteConfirm();
          }
        }}
        onConfirmDelete={() => {
          props.runDeleteConfirm(props.confirmDeleteSession);
        }}
        continueInProject={props.continueInProject}
        continueInProjectBusy={props.continueInProjectBusy}
        trustedProjects={props.recentProjects.filter((project) => project.trust === 'trusted')}
        locale={props.locale}
        onContinueInProjectOpenChange={(open) => {
          if (!open) {
            props.closeContinueInProject();
          }
        }}
        onContinueInProject={(targetScope) => {
          props.runContinueInProject(targetScope, props.onContinueSessionInProject);
        }}
        onCancelContinueInProject={props.closeContinueInProject}
      />

      <SessionSearchDialog
        open={props.sessionSearchOpen}
        onOpenChange={props.onSessionSearchOpenChange}
        query={props.sessionSearch}
        onQueryChange={props.onSessionSearchChange}
        primaryScope={props.state.activeScope}
        primarySessions={props.filteredSessions}
        generalSessions={props.filteredGeneralSessions}
        recentProjects={props.recentProjects}
        locale={props.locale}
        onOpenSession={(sessionId, scope) => {
          void props.onOpenSession(sessionId, { scope });
        }}
      />

      <CommandPalette
        open={props.commandPaletteOpen}
        onOpenChange={props.setCommandPaletteOpen}
        hasProject={Boolean(props.state.projectPath)}
        projectTrusted={props.state.projectTrusted}
        hasActiveSession={Boolean(props.state.activeSessionId)}
        onRun={props.onRunCommand}
      />

      {props.coldRestorePrompt ? (
        <SessionColdRestoreDialog
          sessionId={props.coldRestorePrompt.sessionId}
          storage={props.coldRestorePrompt.storage}
          onCancel={props.clearColdRestorePrompt}
          onRestore={(packPath) => {
            void props.confirmColdRestore(packPath);
          }}
        />
      ) : null}

      <TruncateAfterDialog
        open={props.pendingTruncate !== null}
        locale={props.locale}
        onCancel={props.cancelTruncateAfter}
        onConfirm={() => {
          void props.confirmTruncateAfter();
        }}
      />

      <BranchSwitchConfirmDialog
        open={props.pendingSwitchConfirm !== null}
        locale={props.locale}
        offPathWrites={props.pendingSwitchConfirm?.offPathWrites ?? null}
        onCancel={props.cancelSwitchBranch}
        onConfirm={props.confirmSwitchBranch}
        {...(props.stashThenSwitchBranch
          ? { onStashThenSwitch: props.stashThenSwitchBranch }
          : {})}
      />

      <BranchSwitchConfirmDialog
        open={props.pendingRetryDiscard !== null}
        locale={props.locale}
        intent="discard-attempt"
        offPathWrites={props.pendingRetryDiscard?.offPathWrites ?? null}
        onCancel={props.cancelRetryDiscard}
        onConfirm={props.confirmRetryDiscard}
      />

      <BranchSwitchConfirmDialog
        open={props.pendingBranchLeaves !== null}
        locale={props.locale}
        intent="leave-branch"
        offPathWrites={props.pendingBranchLeaves?.offPathWrites ?? null}
        onCancel={props.cancelBranchLeaves}
        onConfirm={props.confirmBranchLeaves}
      />
    </>
  );
}

export function WorkbenchSettingsOverlay(
  props: WorkbenchSettingsOverlayProps,
): ReactElement | null {
  const [loadGeneration, setLoadGeneration] = useState(0);
  const LazyPanel = useMemo(() => createDeferredSettingsPanel(), [loadGeneration]);

  useEffect(() => {
    if (props.settingsOpen) {
      return;
    }
    setLoadGeneration((generation) => generation + 1);
  }, [props.settingsOpen]);

  if (!props.settingsOpen) {
    return null;
  }

  const isChinese = props.locale === 'zh-CN';
  return (
    <div className="settings-overlay-host" data-testid="settings-overlay-host">
      <SettingsOverlayErrorBoundary
        key={loadGeneration}
        locale={props.locale}
        onRetry={() => setLoadGeneration((generation) => generation + 1)}
        onClose={props.onCloseSettings}
      >
        <DeferredSurfaceBoundary label={isChinese ? '正在加载设置' : 'Loading settings'}>
          <LazyPanel
            hostStatus={props.hostStatus}
            hostClient={props.hostClient}
            request={props.requestConfig}
            preferences={props.preferences}
            activeTheme={props.activeTheme}
            onPreferencesChange={props.onPreferencesChange}
            initialSection={props.settingsSection}
            onSectionChange={props.onSettingsSectionChange}
            projectPath={props.state.projectPath}
            projectTrusted={props.state.projectTrusted}
            requestSkills={props.requestSkills}
            requestMcp={props.requestMcp}
            requestExtensions={props.requestExtensions}
            requestPlugins={props.requestPlugins}
            requestPrompts={props.requestPrompts}
            requestPet={props.requestPet}
            requestAutomation={props.requestAutomation}
            requestSubAgent={props.requestSubAgent as never}
            subagentChildren={props.state.subagentChildren}
            subagentBatches={props.state.subagentBatches}
            subagentInvocations={props.state.subagentInvocations}
            activeSessionId={props.state.activeSessionId}
            onOpenSubagentSession={props.onOpenSubagentSession}
            onThemeApplied={props.onThemeApplied}
            onPetActiveChanged={props.onPetActiveChanged}
            onClose={props.onCloseSettings}
            onSaved={props.onSettingsSaved}
            {...(props.config ? { seedConfig: props.config } : {})}
          />
        </DeferredSurfaceBoundary>
      </SettingsOverlayErrorBoundary>
    </div>
  );
}

type SettingsOverlayErrorBoundaryProps = {
  children: ReactNode;
  locale: DesktopLocale;
  onRetry: () => void;
  onClose: () => void;
};

type SettingsOverlayErrorBoundaryState = {
  error: Error | null;
};

class SettingsOverlayErrorBoundary extends Component<
  SettingsOverlayErrorBoundaryProps,
  SettingsOverlayErrorBoundaryState
> {
  state: SettingsOverlayErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SettingsOverlayErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[piwin] settings overlay failed', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    const isChinese = this.props.locale === 'zh-CN';
    return (
      <div className="settings-overlay-error" data-testid="settings-overlay-error">
        <Notice
          tone="error"
          title={isChinese ? '设置页没有打开' : 'Settings failed to open'}
          testId="settings-overlay-error-notice"
          action={
            <>
              <Button variant="ghost" onClick={this.props.onRetry}>
                {isChinese ? '重试' : 'Retry'}
              </Button>
              <Button variant="ghost" onClick={this.props.onClose}>
                {isChinese ? '返回' : 'Back'}
              </Button>
            </>
          }
          details={this.state.error.message}
        >
          {isChinese
            ? '设置界面没有加载成功。会话还在，可以重试或先返回工作台。'
            : 'Settings did not load. Your session is still here — retry or go back to the workspace.'}
        </Notice>
      </div>
    );
  }
}
