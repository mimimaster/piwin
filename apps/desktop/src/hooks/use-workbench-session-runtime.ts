/**
 * Session actions, branch tree, hydrate/restore, and settings-save queue.
 * Do not list hydrateSessions on the cold-start / folder-tree effect deps.
 */
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { type SessionListOrder } from '@piwin/contracts';
import type { HostLogEntry } from '../HostLogPanel';
import { listArchivedHydrationRequests } from '../workbench-chrome-assembly';
import { resolveSessionScopeHintFromSearchHits } from '../workbench-session-lifecycle';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { useBranchActions } from './use-branch-actions';
import { useSessionActions } from './use-session-actions';
import { useSettingsSaveQueue } from './use-settings-save-queue';
import { useWorkbenchDesktopConfig } from './use-workbench-desktop-config';
import { useWorkbenchSessionLifecycle } from './use-workbench-session-lifecycle';
import type { WorkbenchHostRuntime } from './use-workbench-host-runtime';
import type { WorkbenchShellChrome } from './use-workbench-shell-chrome';

export type UseWorkbenchSessionRuntimeArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  chrome: WorkbenchShellChrome;
  host: WorkbenchHostRuntime;
  setHostLogEntries: Dispatch<SetStateAction<HostLogEntry[]>>;
};

export function useWorkbenchSessionRuntime(args: UseWorkbenchSessionRuntimeArgs) {
  const { hostClient, state, dispatch, chrome, host, setHostLogEntries } = args;
  const {
    projectInput,
    setProjectInput,
    sessionListChrome,
    sessionListQuery,
    selectedModelKey,
    thinkingLevel,
    sessionComposerProfileRestoredRef,
    setEditingMessageId,
    agentMode,
    orchestrationSchemeId,
    delegationDisabled,
    confirmForegroundReplace,
    desktopLocale,
    setSelectedModelKey,
    setPreferences,
  } = chrome;
  const { showArchivedSessions, sessionListOrder, setSessionListOrder, setRenameDraft, setProjectPickerOpen } =
    sessionListChrome;
  const { remoteSearchHitsByScope } = sessionListQuery;
  const resolveSessionScopeHint = useCallback(
    (sessionId: string) => resolveSessionScopeHintFromSearchHits(remoteSearchHitsByScope, sessionId),
    [remoteSearchHitsByScope],
  );
  const {
    hydrateSessions,
    transcriptHistoryLoading,
    loadUserMessageIndex,
    handleJumpToHistoryAnchor,
    handleReturnToLiveTranscript,
    handleOpenWorkspaceClick,
    handleBrowseProject,
    handleOpenProject,
    handleTrustProject,
    ensureSession,
    handleNewSession,
    handleResumeSession,
    coldRestorePrompt,
    confirmColdRestore,
    clearColdRestorePrompt,
    handleLoadOlderTranscript,
    handleRenameSession,
    handleDuplicateSession,
    handleContinueSessionInProject,
    handleForkSession,
    handleSessionMenuAction,
    confirmDeleteSession,
    handlePause,
    handleResumeRun,
    handleAbort,
    handleCompact,
    handleCompactAbort,
    handlePermission,
  } = useSessionActions({
    hostClient,
    state,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    projectInput,
    setProjectInput,
    setProjectPickerOpen,
    showArchivedSessions,
    sessionListOrder,
    resolveSessionScopeHint,
    selectedModelKey,
    modelOptions: host.modelOptions,
    thinkingLevel,
    setRenameDraft,
    setHostLogEntries,
    onSessionComposerProfileRestored: (profile) => {
      sessionComposerProfileRestoredRef.current(profile);
    },
  });

  const { saveSettingsInOrder } = useSettingsSaveQueue({
    hostClient,
    desktopLocale,
    dispatchNotification: host.dispatchNotification,
  });
  const {
    effectiveRunMode,
    handleRunModeChange,
    handleRunModeSetDefault,
    handleSettingsSaved,
    handleSettingsPreferencesChange,
  } = useWorkbenchDesktopConfig({
    config: host.config,
    setConfig: host.setConfig,
    setSelectedModelKey,
    setPreferences,
    saveSettingsInOrder,
    activeSessionId: state.activeSessionId,
    activeScope: state.activeScope,
  });

  const {
    branchPoints,
    switchBranch,
    branchResend,
    retryTurn,
    requestTruncateAfter,
    pendingTruncate,
    confirmTruncateAfter,
    cancelTruncateAfter,
    pendingSwitchConfirm,
    confirmSwitchBranch,
    cancelSwitchBranch,
    pendingRetryDiscard,
    confirmRetryDiscard,
    cancelRetryDiscard,
  } = useBranchActions({
    hostClient,
    activeSessionId: state.activeSessionId,
    streaming: state.streaming,
    projectTrusted: state.projectTrusted,
    isGeneralScope: state.activeScope.kind === 'general' || !state.projectPath,
    transcriptOwnerSessionId: state.transcriptOwnerSessionId,
    visibleMessages: state.historyView?.messages ?? state.messages,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    setEditingMessageId,
    locale: desktopLocale,
    selectedModelKey,
    modelOptions: host.modelOptions,
    thinkingLevel,
    agentMode,
    permissionPreset: effectiveRunMode,
    orchestrationSchemeId,
    delegationDisabled,
    confirmForegroundReplace,
  });

  useEffect(() => {
    const sessionId = state.activeSessionId;
    if (!sessionId || state.userMessageIndex !== null || state.streaming) {
      return;
    }
    // The index is a small independent query. Keep transcript hydration and
    // the live tail responsive while it arrives.
    void loadUserMessageIndex(sessionId, state.userMessageIndexEpoch);
  }, [
    loadUserMessageIndex,
    state.activeSessionId,
    state.streaming,
    state.userMessageIndex,
    state.userMessageIndexEpoch,
  ]);

  const { recentProjects, handleRemoveProjectFromSidebar } = useWorkbenchSessionLifecycle({
    hostClient,
    hostReady: state.hostReady,
    projectPath: state.projectPath,
    config: host.config,
    setConfig: host.setConfig,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    hydrateSessions,
    handleOpenProject,
    handleResumeSession,
    showArchivedSessions,
    remoteCatchUpEpoch: host.remoteCatchUpEpoch,
    saveSettingsInOrder,
  });
  const handleSessionListOrderChange = useCallback(
    (order: SessionListOrder): void => {
      setSessionListOrder(order);
      for (const request of listArchivedHydrationRequests({
        includeArchived: showArchivedSessions,
        order,
        recentProjects,
        activeProjectPath: state.projectPath,
      })) {
        void hydrateSessions(request.scope, request.options);
      }
    },
    [hydrateSessions, recentProjects, setSessionListOrder, showArchivedSessions, state.projectPath],
  );
  const handleResumeSessionRef = useRef(handleResumeSession);
  handleResumeSessionRef.current = handleResumeSession;
  const handleSettingsOpenSubagentSession = useCallback((sessionId: string): void => {
    void handleResumeSessionRef.current(sessionId);
  }, []);

  return {
    hydrateSessions,
    transcriptHistoryLoading,
    loadUserMessageIndex,
    handleJumpToHistoryAnchor,
    handleReturnToLiveTranscript,
    handleOpenWorkspaceClick,
    handleBrowseProject,
    handleOpenProject,
    handleTrustProject,
    ensureSession,
    handleNewSession,
    handleResumeSession,
    coldRestorePrompt,
    confirmColdRestore,
    clearColdRestorePrompt,
    handleLoadOlderTranscript,
    handleRenameSession,
    handleDuplicateSession,
    handleContinueSessionInProject,
    handleForkSession,
    handleSessionMenuAction,
    confirmDeleteSession,
    handlePause,
    handleResumeRun,
    handleAbort,
    handleCompact,
    handleCompactAbort,
    handlePermission,
    branchPoints,
    switchBranch,
    branchResend,
    retryTurn,
    requestTruncateAfter,
    pendingTruncate,
    confirmTruncateAfter,
    cancelTruncateAfter,
    pendingSwitchConfirm,
    confirmSwitchBranch,
    cancelSwitchBranch,
    pendingRetryDiscard,
    confirmRetryDiscard,
    cancelRetryDiscard,
    handleSessionListOrderChange,
    handleSettingsOpenSubagentSession,
    recentProjects,
    handleRemoveProjectFromSidebar,
    saveSettingsInOrder,
    effectiveRunMode,
    handleRunModeChange,
    handleRunModeSetDefault,
    handleSettingsSaved,
    handleSettingsPreferencesChange,
  };
}

export type WorkbenchSessionRuntime = ReturnType<typeof useWorkbenchSessionRuntime>;
