/**
 * Modal stack + settings overlay of the desktop workbench (extracted from App).
 * Host commands stay with App; this file owns dialog/settings chrome.
 */
import { useEffect, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import type { PetPanelProps } from './PetPanel';
import type {
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
  DeferredSettingsPanel,
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
import { isRemoteDesktopTransport } from './remote-session-hydrate';
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
    projectPath: string,
    continueSession: (sessionId: string, projectPath: string) => Promise<boolean>,
  ) => void;
  onContinueSessionInProject: (sessionId: string, projectPath: string) => Promise<boolean>;
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
        {...(isRemoteDesktopTransport(props.hostClient.getTransport())
          ? {
              hostWorkspacePicker: true,
              ...(hostOsFamily === undefined ? {} : { hostOsFamily }),
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
        onContinueInProject={(projectPath) => {
          props.runContinueInProject(projectPath, props.onContinueSessionInProject);
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
      />
    </>
  );
}

export function WorkbenchSettingsOverlay(
  props: WorkbenchSettingsOverlayProps,
): ReactElement | null {
  if (!props.settingsOpen) {
    return null;
  }
  return (
    <DeferredSurfaceBoundary label={props.locale === 'zh-CN' ? '正在加载设置' : 'Loading settings'}>
      <DeferredSettingsPanel
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
        activeSessionId={props.state.activeSessionId}
        onOpenSubagentSession={props.onOpenSubagentSession}
        onThemeApplied={props.onThemeApplied}
        onPetActiveChanged={props.onPetActiveChanged}
        onClose={props.onCloseSettings}
        onSaved={props.onSettingsSaved}
        {...(props.config ? { seedConfig: props.config } : {})}
      />
    </DeferredSurfaceBoundary>
  );
}
