/**
 * Workbench composition root: shell chrome + host/session owners + slot tree.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { HostLogProvider } from './host-log-context';
import { artifactFenceSecurityProps } from './artifact-fence-security';
import type { MediaLibraryItem, ThemeManifest } from '@piwin/contracts';
import { appendQuotedComposerText, focusComposerInput } from './context-menu/desktop-context-menu-value';
import { mediaAttachmentFromLibraryItem } from './media-image-target';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import { useWorkbenchHostClient } from './use-workbench-host-client';
import { MediaPreviewReadProvider } from './media-preview-read-context';
import { LocalFileActionsProvider } from './local-file-actions-context';
import type { HostLogEntry } from './HostLogPanel';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { DesktopContextMenuProvider } from './context-menu';
import { SubagentInspectorProvider } from './subagent-inspector-context';
import { SubagentStopProvider } from './subagent-stop-controller';
import {
  SubagentReviewLoopProvider,
  useSubagentReviewLoopValue,
} from './subagent-review-loop-context';
import { useWorkbenchShellChrome } from './hooks/use-workbench-shell-chrome';
import { useWorkbenchAppModel } from './hooks/use-workbench-app-model';
import { useShellSessionOpen } from './hooks/use-shell-session-open';
import { DesktopAttentionLayer } from './hooks/use-desktop-attention';
import { installRendererSelfHeal } from './renderer-self-heal';
import { WorkspaceShell } from './workspace-shell';
import { WorkbenchInspector } from './workbench-inspector';
import { SubAgentPanel } from './SubAgentPanel';
import { deriveSubagentOrchestrationView } from './subagent-orchestration-view';
import { SessionContextRow } from './session-context-row';
import {
  WorkbenchComposerColumn,
  WorkbenchPermissionBar,
  WorkbenchTranscript,
} from './workbench-conversation';
import { WorkbenchContextBar } from './workbench-context-bar';
import { LiveBar } from './live/LiveBar.js';
import { WorkbenchOverlays, WorkbenchSettingsOverlay } from './workbench-overlays';
import { WorkbenchSidebar } from './workbench-sidebar';
import { WorkbenchConversationStage } from './workbench-conversation-stage';
import { resolveFocusedConversationSessionId } from './conversation-pane-layout';
import {
  useConversationPaneLayout,
  useConversationPaneSubscriptions,
} from './use-conversation-pane-layout';
import { appendComposerProposal } from './artifact-canvas-model.js';
import { isDockingWorkspaceEnabled } from './workbench/docking/flag.js';
import { DockToolHostsProvider } from './workbench/docking/dock-tool-hosts.js';
import { useDockingWorkspace } from './workbench/docking/use-docking-workspace.js';
import { inspectorTabToToolKind, toolKindToInspectorTab } from './workbench/docking/docking-tool-bridge.js';
import { findViewGroupId, isStageGroupId } from './workbench/docking/topology.js';
import { sessionScopeKey } from './session-scope-key';
import { WorkbenchSubpageStage } from './workbench-subpage-stage';
import { useWorkbenchKnowledge } from './hooks/use-workbench-knowledge';
import { KnowledgeCitationActionsProvider } from './knowledge/knowledge-citation-actions';
import { KnowledgeMountsProvider } from './knowledge/knowledge-mounts-context';
import { isInkstoneThemeId } from './appearance-tokens';

export type AppProps = {
  /** Resolved active manifest owned by DesktopThemeRoot. */
  activeTheme: ThemeManifest;
  /** Root callback that resolves, applies document tokens, and stores a manifest. */
  onThemeApplied: (theme: ThemeManifest) => void;
};

export function AppWorkbench({ activeTheme, onThemeApplied }: AppProps) {
  const hostClient = useWorkbenchHostClient();
  const [state, dispatch] = useReducer(chatUiReducer, undefined, createInitialChatUiState);
  const selfHealBusyRef = useRef(false);
  useEffect(() => installRendererSelfHeal(() => selfHealBusyRef.current), []);
  const [hostLogEntries, setHostLogEntries] = useState<HostLogEntry[]>([]);
  const clearHostLog = useCallback(() => {
    setHostLogEntries([]);
  }, []);
  const chrome = useWorkbenchShellChrome({ hostClient, state });
  const {
    projectInput,
    setProjectInput,
    shell,
    settingsOpen,
    settingsSection,
    commandPaletteOpen,
    navDrawerOpen,
    rightPanelOpen,
    rightPanelTab,
    showOverlayScrim,
    layoutMode,
    inspectorPlacement,
    isOverlayPresentation,
    inspectorOverlay,
    sidebarResize,
    rightPanelResize,
    setRightPanelView,
    activeSubPage,
    setActiveSubPage,
    openLibrary,
    openImages,
    openVideos,
    openFlashcards,
    openMarketplace,
    closeSubPage,
    flashcardsEntry,
    flashcardsFolderPath,
    openKnowledge,
    openFlashcardsProduce,
    sessionListChrome,
    sessionListQuery,
    sidebarMode,
    setSidebarMode,
    editingMessageId,
    setEditingMessageId,
    preferences,
    terminal,
    appShellStyle,
    desktopLocale,
    foregroundReplaceConfirm,
  } = chrome;
  const {
    sessionSearch,
    setSessionSearch,
    sessionSearchOpen,
    setSessionSearchOpen,
    openSessionSearch,
    showArchivedSessions,
    setShowArchivedSessions,
    sessionListOrder,
    sessionMenu,
    renameDraft,
    setRenameDraft,
    projectPickerOpen,
    setProjectPickerOpen,
    deleteConfirm,
    deleteBusy,
    continueInProject,
    continueInProjectBusy,
    openSessionMenu,
    closeSessionMenu,
    requestDeleteSession,
    requestContinueInProject,
    closeDeleteConfirm,
    closeContinueInProject,
    runDeleteConfirm,
    runContinueInProject,
  } = sessionListChrome;
  const { filteredSessions, filteredGeneralSessions, sessionGroups } = sessionListQuery;
  const {
    ptyOutput,
    setPtyOutput,
    terminalAttention,
    setTerminalAttention,
    terminalCwd,
    terminalRecentDirs,
    handleTerminalCwdChange,
  } = terminal;
  const conversationPanesEnabled = state.activeScope.kind === 'general' || state.activeScope.kind === 'project';
  const dockingEnabled = isDockingWorkspaceEnabled();
  const conversationPaneController = useConversationPaneLayout({
    enabled: conversationPanesEnabled && !dockingEnabled,
    primarySessionId: conversationPanesEnabled && !dockingEnabled ? state.activeSessionId : null,
    ...(conversationPanesEnabled ? { scopeKey: sessionScopeKey(state.activeScope) } : {}),
  });
  const dockingActive = conversationPanesEnabled && dockingEnabled;
  const dockingWorkspace = useDockingWorkspace({
    enabled: dockingActive,
    hostClient,
    inspectorTab: rightPanelOpen ? rightPanelTab : null,
    rightPanelOpen,
    onRevealRightTool: (kind) => shell.openInspector(toolKindToInspectorTab(kind)),
    ...(conversationPanesEnabled ? { scopeKey: sessionScopeKey(state.activeScope) } : {}),
  });
  // Docked tools are tabs of the right panel itself. The one exception is a
  // tool the user moved onto the stage: the docking hook above focuses it
  // there, so drop the inspector tab, and fold the panel away again when it
  // was opened only to show that tool.
  const requestedDockTool = dockingActive && rightPanelOpen ? inspectorTabToToolKind(rightPanelTab) : null;
  const requestedDockToolOnStage =
    requestedDockTool !== null &&
    Object.values(dockingWorkspace.state.views).some((view) => {
      if (view.kind !== requestedDockTool) return false;
      const groupId = findViewGroupId(dockingWorkspace.state, view.viewId);
      return groupId !== null && isStageGroupId(dockingWorkspace.state, groupId);
    });
  const inspectorWasOpenRef = useRef(rightPanelOpen);
  useEffect(() => {
    const wasOpen = inspectorWasOpenRef.current;
    inspectorWasOpenRef.current = rightPanelOpen;
    if (!requestedDockToolOnStage) return;
    shell.setInspectorTab(null);
    if (!wasOpen) shell.closeOverlay();
  }, [requestedDockToolOnStage, rightPanelOpen, shell]);
  const liveSessionId = dockingEnabled
    ? dockingWorkspace.state.sessionTargetId ?? state.activeSessionId
    : conversationPanesEnabled
      ? resolveFocusedConversationSessionId({
          layout: conversationPaneController.layout,
          primarySessionId: state.activeSessionId,
        })
      : state.activeSessionId;
  const knowledgeMountsRef = useRef<{
    mountedIds: readonly string[];
    clearDraft: () => void;
  } | null>(null);
  const model = useWorkbenchAppModel({
    hostClient,
    state,
    dispatch,
    chrome,
    activeTheme,
    onThemeApplied,
    setHostLogEntries,
    liveSessionId,
    knowledgeMountsRef,
  });
  const {
    requestConfig,
    requestSubAgent,
    requestSkills,
    requestExtensions,
    requestPlugins,
    requestPrompts,
    requestMcp,
    requestGit,
    requestPet,
    requestPty,
    requestAutomation,
    jobs,
    terminalJobMonitor,
    backendServiceSessionIds,
    hostStatus,
    config,
    setActivePet,
    sessionPlan,
    extensionUiRequest,
    assemblySummariesByRunId,
    inspectorFileDiff,
    fileBrowseRoot,
    activeDocument,
    sessionDocuments,
    artifactThemeKey,
    modelOptions,
    handleArtifactAction,
    handleGenerateWalkthrough,
    handleCancelWalkthrough,
    requestNotesPanel,
    requestCardsPanel,
    resolveConversationFlashcards,
    requestKnowledgeCenter,
    requestFileTree,
    hydrateSessions,
    transcriptHistoryLoading,
    handleJumpToHistoryAnchor,
    handleReturnToLiveTranscript,
    handleOpenWorkspaceClick,
    handleBrowseProject,
    handleOpenProject,
    handleTrustProject,
    handleResumeSession,
    ensureSession,
    coldRestorePrompt,
    confirmColdRestore,
    clearColdRestorePrompt,
    handleLoadOlderTranscript,
    handleRenameSession,
    handleContinueSessionInProject,
    handleForkSession,
    handleSessionMenuAction,
    confirmDeleteSession,
    handleAbort,
    handleCompactAbort,
    handlePermission,
    branchPoints,
    switchBranch,
    branchResend,
    retryTurn,
    continueTurn,
    pendingTruncate,
    confirmTruncateAfter,
    cancelTruncateAfter,
    pendingSwitchConfirm,
    confirmSwitchBranch,
    cancelSwitchBranch,
    stashThenSwitchBranch,
    pendingRetryDiscard,
    confirmRetryDiscard,
    cancelRetryDiscard,
    pendingBranchLeaves,
    confirmBranchLeaves,
    cancelBranchLeaves,
    handleSessionListOrderChange,
    handleSettingsOpenSubagentSession,
    recentProjects,
    handleRemoveProjectFromSidebar,
    effectiveRunMode,
    handleSettingsSaved,
    handleSettingsPreferencesChange,
    composer,
    setComposer,
    pendingAttachments,
    draftSessions,
    activeDraftId,
    addWebElement,
    enqueueAttachmentFile,
    addExistingMediaAttachment,
    handleSend,
    handleOpenDocument,
    handleOpenDiff,
    handleOpenArtifactCanvas,
    handleStartNewSession,
    handleResumeDraft,
    handleRetryMessage,
    handleCommentLine,
    handleExtensionUiResolve,
    desktopContextMenuValue,
    activeComments,
    handleAddDocComment,
    handleEditDocComment,
    handleDeleteDocComment,
    handleToggleAppearance,
    openRightTab,
    openSettingsSection,
    handleDesktopCommand,
    handleLocaleChange,
    runStatus,
    activitySignal,
    historyViewActive,
    visibleTranscriptMessages,
    visibleRunRecordsById,
    lastUserMessage,
    lastUserMessageId,
    activeSessionName,
    activeSessionOrigin,
    composerCard,
    composerLayoutMode,
    live,
    handleInspectSubagent,
    subagentInspectorToggle,
    subagentInspectorPanel,
    subagentStop,
    handleCancelMessageEdit,
    handleInterventionEdit,
    handleInterventionCancel,
    handleEditAndResendMessage,
    handleMessageFeedback,
    handlePlanExecute,
    handlePlanAbort,
    activeMedia,
    readTranscriptMedia,
    forkCountsByMessageId,
    sessionLineage,
    addContextRef,
    dispatchNotification,
    artifactCanvas,
  } = model;
  const openSessionFromShell = useShellSessionOpen({
    setActiveSubPage,
    isOverlayPresentation,
    shell,
    state,
    conversationPanesEnabled,
    dockingEnabled,
    layoutMode,
    dockingWorkspace,
    conversationPaneController,
    handleResumeSession,
  });
  const parentSessionId = state.activeSessionId;
  const tasksActiveCount = useMemo(() => {
    if (!parentSessionId) {
      return 0;
    }
    return deriveSubagentOrchestrationView({
      parentSessionId,
      invocations: state.subagentInvocations,
      children: state.subagentChildren,
      streams: state.subagentStreams,
    }).activeCount;
  }, [
    parentSessionId,
    state.subagentInvocations,
    state.subagentChildren,
    state.subagentStreams,
  ]);
  const tasksChildren = useMemo(
    () =>
      Object.values(state.subagentChildren).filter(
        (child) => !parentSessionId || child.parentSessionId === parentSessionId,
      ),
    [parentSessionId, state.subagentChildren],
  );
  const reviewLoop = useSubagentReviewLoopValue({
    enabled: hostStatus?.capabilities.subagentReviewLoopV1 === true,
    parentSessionId,
    results: state.subagentResults,
    verifications: state.subagentVerifications,
    taskResults: state.subagentTaskResults,
    reviews: state.subagentReviews,
    hostClient,
    onInspect: handleInspectSubagent,
  });
  selfHealBusyRef.current =
    state.streaming ||
    state.compacting ||
    composer.trim().length > 0 ||
    pendingAttachments.length > 0;
  const mediaStudioOpen =
    activeSubPage === 'library' || activeSubPage === 'images' || activeSubPage === 'videos';
  const studioOpen =
    mediaStudioOpen || activeSubPage === 'flashcards' || activeSubPage === 'knowledge';
  const knowledgeSupported = hostStatus?.capabilities.knowledgeBases === true;
  const activeSessionListItem =
    state.sessions.find((session) => session.id === state.activeSessionId) ??
    state.generalSessions.find((session) => session.id === state.activeSessionId);
  const reportKnowledgeError = useCallback(
    (message: string) => {
      dispatchNotification({ type: 'notify/push', notification: { level: 'error', message } });
    },
    [dispatchNotification],
  );
  const knowledge = useWorkbenchKnowledge({
    hostClient,
    supported: knowledgeSupported,
    activeSessionId: state.activeSessionId,
    sessionMountedIds: activeSessionListItem?.knowledgeBaseIds,
    openKnowledge,
    closeSubPage,
    focusComposer: focusComposerInput,
    openDocument: handleOpenDocument,
    reportError: reportKnowledgeError,
  });
  knowledgeMountsRef.current = knowledgeSupported
    ? { mountedIds: knowledge.mounts.mountedIds, clearDraft: knowledge.mounts.clearDraft }
    : null;
  const [mediaLibraryEpoch, setMediaLibraryEpoch] = useState(0);
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !state.streaming) {
      setMediaLibraryEpoch((epoch) => epoch + 1);
    }
    wasStreamingRef.current = state.streaming;
  }, [state.streaming]);
  const handleRemixToComposer = useCallback(
    (input: { text: string; item?: MediaLibraryItem }) => {
      if (input.item) {
        addExistingMediaAttachment(mediaAttachmentFromLibraryItem(input.item));
      }
      const draft = input.text.trim();
      if (draft) {
        setComposer((current) => appendQuotedComposerText(current, draft));
      }
      closeSubPage();
      window.setTimeout(() => focusComposerInput(), 0);
    },
    [addExistingMediaAttachment, setComposer, closeSubPage],
  );
  const composerColumn = (
    <WorkbenchComposerColumn
      state={state}
      activeTheme={activeTheme}
      activeSessionName={activeSessionName}
      composerCard={composerCard}
      onTrustProject={handleTrustProject}
      onUnarchiveSession={(sessionId) => void handleSessionMenuAction(sessionId, 'unarchive')}
      onNewSession={handleStartNewSession}
    />
  );

  const sessionContextRow =
    hostClient.supportsCommand('git/status') &&
    state.activeScope.kind === 'project' &&
    state.activeScope.projectPath ? (
      <SessionContextRow
        projectPath={state.activeScope.projectPath}
        recentProjects={recentProjects}
        request={requestGit}
        onOpenProject={(path) => void handleOpenProject(path)}
        disabled={state.streaming}
      />
    ) : null;
  const inkstoneStage = isInkstoneThemeId(activeTheme.id) || activeTheme.visualStyle === 'paper';

  useConversationPaneSubscriptions({
    hostClient,
    activeSessionId: state.activeSessionId,
    paneLayout: conversationPaneController.layout,
    panesEnabled: conversationPanesEnabled && !dockingEnabled,
  });
  const handleCreatePaneConversation = useCallback(
    async (_paneId: string): Promise<string | null> => {
      const scope =
        state.activeScope.kind === 'project'
          ? { kind: 'project' as const, projectPath: state.activeScope.projectPath }
          : { kind: 'general' as const };
      return ensureSession({ scope, activate: false });
    },
    [ensureSession, state.activeScope],
  );

  return (
    <DesktopLocaleProvider locale={desktopLocale} onLocaleChange={handleLocaleChange}>
      <HostLogProvider value={{ entries: hostLogEntries, onClear: clearHostLog }}>
      <LocalFileActionsProvider request={(command) => hostClient.request(command)}>
        <MediaPreviewReadProvider sessionId={state.activeSessionId} readMedia={readTranscriptMedia}>
          <DesktopContextMenuProvider value={desktopContextMenuValue}>
            <SubagentInspectorProvider
              toggle={subagentInspectorToggle}
              panel={subagentInspectorPanel}
            >
              <SubagentStopProvider value={subagentStop}>
              {subagentStop.dialog}
              <SubagentReviewLoopProvider value={reviewLoop}>
              <KnowledgeMountsProvider value={knowledgeSupported ? knowledge.mounts : null}>
              <KnowledgeCitationActionsProvider value={knowledge.citationActions}>
              <DockToolHostsProvider
                value={{
                  hostClient,
                  locale: desktopLocale,
                  activeTheme,
                  artifactThemeKey,
                  projectPath: state.projectPath,
                  requestGit,
                  addWebElement,
                  artifactTarget: artifactCanvas.activeTarget,
                  onInsertCanvasProposal: (text) =>
                    setComposer((current) => appendComposerProposal(current, text)),
                  activeDocument,
                  inspectorDiff: inspectorFileDiff.diff,
                  ...(activeMedia ? { activeMedia } : {}),
                }}
              >
              <div
                className={`app-shell workbench${rightPanelOpen ? ' has-right-panel' : ''}${navDrawerOpen ? ' nav-open' : ''}${settingsOpen ? ' settings-open' : ''}${studioOpen ? ' studio-open' : ''}${rightPanelResize.isResizing || sidebarResize.isResizing ? ' is-resizing-panels' : ''}${rightPanelOpen && inspectorPlacement === 'column' && rightPanelResize.isFullWidth ? ' right-panel-full-width' : ''}`}
                style={appShellStyle}
                data-testid="app-shell"
                data-layout={layoutMode}
                data-inspector={inspectorPlacement}
                data-right={rightPanelOpen ? 'expanded' : 'collapsed'}
                data-right-panel-full-width={
                  rightPanelOpen && inspectorPlacement === 'column' && rightPanelResize.isFullWidth
                    ? 'true'
                    : 'false'
                }
                data-settings-open={settingsOpen ? 'true' : 'false'}
                data-studio-open={studioOpen ? 'true' : 'false'}
              >
                <WorkspaceShell
                  workspaceClassName={
                    settingsOpen || studioOpen ? 'settings-workspace-suspended' : undefined
                  }
                  sidebar={
                    <WorkbenchSidebar
                      state={state}
                      hostClient={hostClient}
                      hostStatus={hostStatus}
                      recentProjects={recentProjects}
                      filteredSessions={filteredSessions}
                      filteredGeneralSessions={filteredGeneralSessions}
                      sessionGroups={sessionGroups}
                      sessionListOrder={sessionListOrder}
                      onSessionListOrderChange={handleSessionListOrderChange}
                      sessionSearch={sessionSearch}
                      onOpenSessionSearch={openSessionSearch}
                      showArchivedSessions={showArchivedSessions}
                      setShowArchivedSessions={setShowArchivedSessions}
                      hydrateSessions={hydrateSessions}
                      settingsOpen={settingsOpen}
                      activeSubPage={activeSubPage}
                      onOpenLibrary={openLibrary}
                      onOpenImages={openImages}
                      onOpenVideos={openVideos}
                      onOpenFlashcards={openFlashcards}
                      onOpenKnowledge={openKnowledge}
                      onOpenMarketplace={openMarketplace}
                      onOpenWorkspace={handleOpenWorkspaceClick}
                      onOpenProject={handleOpenProject}
                      onRemoveProject={handleRemoveProjectFromSidebar}
                      onNewSession={(options) => {
                        setActiveSubPage(null);
                        if (isOverlayPresentation) {
                          shell.closeOverlay();
                        }
                        return handleStartNewSession(options);
                      }}
                      onResumeSession={openSessionFromShell}
                      onResumeDraft={(draftId) => {
                        setActiveSubPage(null);
                        if (isOverlayPresentation) {
                          shell.closeOverlay();
                        }
                        return handleResumeDraft(draftId);
                      }}
                      draftSessions={draftSessions}
                      activeDraftId={activeDraftId}
                      sessionMenu={sessionMenu}
                      onOpenSessionMenu={openSessionMenu}
                      onSessionMenuAction={handleSessionMenuAction}
                      onRequestDeleteSession={requestDeleteSession}
                      openSettingsSection={openSettingsSection}
                      dispatch={dispatch}
                      isOverlayPresentation={isOverlayPresentation}
                      locale={desktopLocale}
                      sidebarResize={sidebarResize}
                      backendServiceSessionIds={backendServiceSessionIds}
                      shell={shell}
                      sidebarMode={sidebarMode}
                      onSidebarModeChange={setSidebarMode}
                    />
                  }
                  stageHeader={undefined}
                  sessionContext={inkstoneStage ? null : sessionContextRow}
                  titlebar={
                    <WorkbenchContextBar
                      state={state}
                      sidebarMode={sidebarMode}
                      recentProjects={recentProjects}
                      activeSessionName={activeSessionName}
                      activeSessionOrigin={activeSessionOrigin}
                      branchPoints={branchPoints}
                      streaming={state.streaming}
                      onSwitchBranch={(headMessageId) => {
                        void switchBranch(headMessageId);
                      }}
                      runStatus={runStatus}
                      lastUserMessage={lastUserMessage}
                      effectiveRunMode={effectiveRunMode}
                      locale={desktopLocale}
                      appearanceMode={activeTheme.mode === 'light' ? 'light' : 'dark'}
                      sessionsExpanded={navDrawerOpen}
                      workPanelOpen={rightPanelOpen}
                      rightPanelTab={rightPanelTab}
                      shell={shell}
                      onStop={handleAbort}
                      onCancelCompact={handleCompactAbort}
                      onOpenInspector={openRightTab}
                      openSettingsSection={openSettingsSection}
                      onToggleAppearance={handleToggleAppearance}
                      onResumeSession={handleResumeSession}
                      onRetryLastUser={(messageId) => {
                        void retryTurn(messageId, { keepPrevious: false });
                      }}
                      onOpenSessionSearch={openSessionSearch}
                      trailing={sessionContextRow}
                      isInkstone={inkstoneStage}
                    />
                  }
                  chatColumnClassName={
                    [
                      composerLayoutMode === 'centered' ? 'chat-column-empty' : '',
                      activeTheme.visualStyle === 'ink-wash' ? 'theme-visual-ink-wash' : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  renderStage={(primaryPane) => (
                    <DesktopAttentionLayer hostClient={hostClient} state={state} dispatch={dispatch} locale={desktopLocale} hostStatus={hostStatus} extensionUiRequest={extensionUiRequest} isOverlayPresentation={isOverlayPresentation} activeSubPage={activeSubPage} dockingEnabled={dockingEnabled} dockingWorkspace={dockingWorkspace} conversationPanesEnabled={conversationPanesEnabled} conversationPaneController={conversationPaneController} openSessionFromShell={openSessionFromShell} recentProjects={recentProjects}>
                    <WorkbenchConversationStage
                      primaryPane={primaryPane}
                      dockingEnabled={dockingEnabled}
                      docking={dockingWorkspace}
                      conversationPanesEnabled={conversationPanesEnabled}
                      conversationPaneController={conversationPaneController}
                      phoneSinglePane={layoutMode === 'phone'}
                      primarySessionId={state.activeSessionId}
                      onPromoteSession={(sessionId) => void handleResumeSession(sessionId)}
                      activeProjectScopeKey={sessionScopeKey(state.activeScope)}
                      primarySessionName={
                        activeSessionName ||
                        (desktopLocale === 'zh-CN' ? '素笺' : 'Clean Slate')
                      }
                      sessions={
                        state.activeScope.kind === 'general'
                          ? state.generalSessions
                          : state.sessions
                      }
                      hostClient={hostClient}
                      activeTheme={activeTheme}
                      artifactThemeKey={artifactThemeKey}
                      artifactPreviewEnabled={config?.artifact?.enabled ?? true}
                      readMedia={readTranscriptMedia}
                      locale={desktopLocale}
                      keyboardEnabled={!settingsOpen && !activeSubPage}
                      onCreateConversation={handleCreatePaneConversation}
                      onOpenDocument={handleOpenDocument}
                      onOpenArtifactCanvas={handleOpenArtifactCanvas}
                      fileBrowseRoot={fileBrowseRoot}
                    />
                    </DesktopAttentionLayer>
                  )}
                  transcript={
                    <WorkbenchTranscript
                      locale={desktopLocale}
                      hostClient={hostClient}
                      state={state}
                      sidebarMode={sidebarMode}
                      visibleMessages={visibleTranscriptMessages}
                      visibleRunRecordsById={visibleRunRecordsById}
                      historyViewActive={historyViewActive}
                      activitySignal={activitySignal}
                      transcriptHistoryLoading={transcriptHistoryLoading}
                      lastUserMessageId={lastUserMessageId}
                      composerCard={composerCard}
                      config={config}
                      preferences={preferences}
                      scopeSessions={
                        state.activeScope.kind === 'general'
                          ? state.generalSessions
                          : state.sessions
                      }
                      onOpenAllSessions={openSessionSearch}
                      runningSessionIds={backendServiceSessionIds}
                      modelOptions={modelOptions}
                      requestKnowledgeCenter={requestKnowledgeCenter}
                      resolveFlashcards={resolveConversationFlashcards}
                      requestGit={requestGit}
                      editingMessageId={editingMessageId}
                      activeTheme={activeTheme}
                      artifactThemeKey={artifactThemeKey}
                      assemblySummariesByRunId={assemblySummariesByRunId}
                      sessionLineage={sessionLineage}
                      forkCountsByMessageId={forkCountsByMessageId}
                      branchPoints={branchPoints}
                      onJumpToHistoryAnchor={handleJumpToHistoryAnchor}
                      onReturnToLatest={handleReturnToLiveTranscript}
                      onLoadOlder={handleLoadOlderTranscript}
                      onOpenReview={() => openRightTab('review')}
                      onPermission={handlePermission}
                      onInspectSubagent={handleInspectSubagent}
                      onEdit={setEditingMessageId}
                      onCancelEdit={handleCancelMessageEdit}
                      onEditResend={handleEditAndResendMessage}
                      onRetry={handleRetryMessage}
                      onRetryTurn={retryTurn}
                      onContinueTurn={continueTurn}
                      onBranchResend={branchResend}
                      onSwitchBranch={switchBranch}
                      onInterventionEdit={handleInterventionEdit}
                      onInterventionCancel={handleInterventionCancel}
                      onFeedback={handleMessageFeedback}
                      onArtifactAction={handleArtifactAction}
                      onOpenArtifactCanvas={handleOpenArtifactCanvas}
                      onOpenDocument={handleOpenDocument}
                      onOpenDiff={handleOpenDiff}
                      fileBrowseRoot={fileBrowseRoot}
                      onGenerateWalkthrough={handleGenerateWalkthrough}
                      onCancelWalkthrough={handleCancelWalkthrough}
                      onForkFromMessage={handleForkSession}
                      onOpenSession={handleResumeSession}
                      onCompactAbort={handleCompactAbort}
                      onPlanExecute={handlePlanExecute}
                      {...(sessionPlan ? { sessionPlan } : {})}
                    />
                  }
                  permissionBar={
                    <WorkbenchPermissionBar
                      state={state}
                      sidebarMode={sidebarMode}
                      extensionUiRequest={extensionUiRequest}
                      sessionPlan={sessionPlan}
                      onPlanAbort={handlePlanAbort}
                      onOpenDocument={handleOpenDocument}
                      onPermission={handlePermission}
                      onExtensionUiResolve={handleExtensionUiResolve}
                    />
                  }
                  composerDock={studioOpen ? null : composerColumn}
                  rightPanel={
                    <WorkbenchInspector
                      showOverlayScrim={showOverlayScrim}
                      shell={shell}
                      rightPanelOpen={rightPanelOpen}
                      rightPanelTab={rightPanelTab}
                      rightPanelResize={rightPanelResize}
                      isOverlayPresentation={inspectorOverlay}
                      runningJobCount={jobs.length}
                      terminalAttention={terminalAttention}
                      onTerminalAttentionClear={() => setTerminalAttention(false)}
                      onViewChange={setRightPanelView}
                      docking={dockingActive ? dockingWorkspace : null}
                      locale={desktopLocale}
                      activeTheme={activeTheme}
                      onToggleAppearance={handleToggleAppearance}
                      openSettingsSection={openSettingsSection}
                      hostClient={hostClient}
                      requestNotesPanel={requestNotesPanel}
                      requestCardsPanel={requestCardsPanel}
                      requestFileTree={requestFileTree}
                      requestGit={requestGit}
                      requestPty={requestPty}
                      projectPath={state.projectPath}
                      fileBrowseRoot={fileBrowseRoot}
                      onOpenWorkspace={handleOpenWorkspaceClick}
                      projectTrusted={state.projectTrusted}
                      activeSessionId={state.activeSessionId}
                      walkthroughsByMessageId={state.walkthroughsByMessageId}
                      addContextRef={addContextRef}
                      dispatchNotification={dispatchNotification}
                      handleSend={handleSend}
                      setComposer={setComposer}
                      artifactTarget={artifactCanvas.activeTarget}
                      artifactThemeKey={artifactThemeKey}
                      {...artifactFenceSecurityProps(config?.artifact)}
                      addWebElement={addWebElement}
                      onAddImageFile={(file) => enqueueAttachmentFile(file, 'file-picker')}
                      inspectorDiff={inspectorFileDiff.diff}
                      activeMedia={activeMedia}
                      activeDocument={activeDocument}
                      sessionDocuments={sessionDocuments}
                      handleOpenDocument={handleOpenDocument}
                      handleCommentLine={handleCommentLine}
                      activeComments={activeComments}
                      handleAddDocComment={handleAddDocComment}
                      handleEditDocComment={handleEditDocComment}
                      handleDeleteDocComment={handleDeleteDocComment}
                      sessionPlan={sessionPlan}
                      ptyOutput={ptyOutput}
                      setPtyOutput={setPtyOutput}
                      terminalCwd={terminalCwd}
                      handleTerminalCwdChange={handleTerminalCwdChange}
                      terminalRecentDirs={terminalRecentDirs}
                      terminalJobMonitor={terminalJobMonitor}
                      tasksActiveCount={tasksActiveCount}
                      tasksContent={
                        <SubAgentPanel
                          parentSessionId={parentSessionId}
                          request={requestSubAgent}
                          onOpenSession={handleResumeSession}
                          children={tasksChildren}
                          batches={state.subagentBatches}
                          invocations={state.subagentInvocations}
                          streams={state.subagentStreams}
                        />
                      }
                    />
                  }
                />
                {live.starting || live.call ? (
                  <div className="live-bar-host">
                    <LiveBar
                      call={live.call}
                      starting={live.starting}
                      peer={live.peer}
                      error={live.error}
                      intendedSessionId={liveSessionId}
                      onRetry={() => {
                        // Start-failure chrome only; LiveBar hides Retry while a call is up.
                        if (live.call) return;
                        void live.start();
                      }}
                      onDismiss={live.dismissError}
                      onMute={(muted) => {
                        void live.setMuted(muted);
                      }}
                      onEnd={() => {
                        void live.end();
                      }}
                    />
                  </div>
                ) : null}

                {foregroundReplaceConfirm.dialog}

                <WorkbenchOverlays
                  state={state}
                  hostClient={hostClient}
                  locale={desktopLocale}
                  projectInput={projectInput}
                  setProjectInput={setProjectInput}
                  projectPickerOpen={projectPickerOpen}
                  setProjectPickerOpen={setProjectPickerOpen}
                  onOpenProject={handleOpenProject}
                  onBrowseProject={handleBrowseProject}
                  onTrustProject={handleTrustProject}
                  sessionMenu={sessionMenu}
                  closeSessionMenu={closeSessionMenu}
                  onSessionMenuAction={handleSessionMenuAction}
                  requestDeleteSession={requestDeleteSession}
                  requestContinueInProject={requestContinueInProject}
                  renameDraft={renameDraft}
                  setRenameDraft={setRenameDraft}
                  onRenameSession={handleRenameSession}
                  onPermission={handlePermission}
                  deleteConfirm={deleteConfirm}
                  deleteBusy={deleteBusy}
                  closeDeleteConfirm={closeDeleteConfirm}
                  runDeleteConfirm={runDeleteConfirm}
                  confirmDeleteSession={confirmDeleteSession}
                  continueInProject={continueInProject}
                  continueInProjectBusy={continueInProjectBusy}
                  closeContinueInProject={closeContinueInProject}
                  runContinueInProject={runContinueInProject}
                  onContinueSessionInProject={handleContinueSessionInProject}
                  recentProjects={recentProjects}
                  sessionSearchOpen={sessionSearchOpen}
                  onSessionSearchOpenChange={setSessionSearchOpen}
                  sessionSearch={sessionSearch}
                  onSessionSearchChange={setSessionSearch}
                  filteredSessions={filteredSessions}
                  filteredGeneralSessions={filteredGeneralSessions}
                  onOpenSession={handleResumeSession}
                  commandPaletteOpen={commandPaletteOpen}
                  setCommandPaletteOpen={shell.setCommandPaletteOpen}
                  onRunCommand={handleDesktopCommand}
                  coldRestorePrompt={coldRestorePrompt}
                  clearColdRestorePrompt={clearColdRestorePrompt}
                  confirmColdRestore={confirmColdRestore}
                  pendingTruncate={pendingTruncate}
                  cancelTruncateAfter={cancelTruncateAfter}
                  confirmTruncateAfter={confirmTruncateAfter}
                  pendingSwitchConfirm={pendingSwitchConfirm}
                  cancelSwitchBranch={cancelSwitchBranch}
                  confirmSwitchBranch={confirmSwitchBranch}
                  stashThenSwitchBranch={stashThenSwitchBranch}
                  pendingRetryDiscard={pendingRetryDiscard}
                  cancelRetryDiscard={cancelRetryDiscard}
                  confirmRetryDiscard={confirmRetryDiscard}
                  pendingBranchLeaves={pendingBranchLeaves}
                  cancelBranchLeaves={cancelBranchLeaves}
                  confirmBranchLeaves={confirmBranchLeaves}
                />
              </div>
              <WorkbenchSubpageStage
                activeSubPage={activeSubPage}
                locale={desktopLocale}
                onClose={closeSubPage}
                request={(command) => hostClient.request(command)}
                requestFlashcards={(command, options) => hostClient.request(command, options)}
                refreshToken={mediaLibraryEpoch}
                onRemixToComposer={handleRemixToComposer}
                projectPath={state.projectPath}
                sessionId={state.activeSessionId}
                onConfigureEmbedding={() => {
                  closeSubPage();
                  openSettingsSection('knowledge');
                }}
                subscribePush={(listener) =>
                  hostClient.subscribe((message) => {
                    if (message.type === 'flashcards/study/changed') listener(message);
                  })
                }
                subscribeConnected={(listener) => {
                  listener(hostClient.isReady());
                  return hostClient.subscribe((message) => {
                    if (message.type === 'host/status') listener(message.ready);
                  });
                }}
                hasStudyCapability={() =>
                  hostStatus?.capabilities.flashcardStudy === true
                }
                flashcardsEntry={flashcardsEntry}
                flashcardsFolderPath={flashcardsFolderPath}
                onOpenSession={handleResumeSession}
                subscribeKnowledgePush={knowledge.subscribeKnowledgePush}
                knowledgeSupported={knowledgeSupported}
                onOpenIngest={openFlashcardsProduce}
                onUseKnowledgeInChat={knowledge.useInChat}
                onOpenKnowledgeCitation={knowledge.citationActions.openCitation}
              />
              <WorkbenchSettingsOverlay
                settingsOpen={settingsOpen}
                locale={desktopLocale}
                hostStatus={hostStatus}
                hostClient={hostClient}
                requestConfig={requestConfig}
                preferences={preferences}
                activeTheme={activeTheme}
                onPreferencesChange={handleSettingsPreferencesChange}
                settingsSection={settingsSection}
                onSettingsSectionChange={shell.setSettingsSection}
                state={state}
                requestSkills={requestSkills}
                requestMcp={requestMcp}
                requestExtensions={requestExtensions}
                requestPlugins={requestPlugins}
                requestPrompts={requestPrompts}
                requestPet={requestPet}
                requestAutomation={requestAutomation}
                requestSubAgent={requestSubAgent}
                onOpenSubagentSession={handleSettingsOpenSubagentSession}
                onThemeApplied={onThemeApplied}
                onPetActiveChanged={setActivePet}
                onCloseSettings={shell.closeSettings}
                onSettingsSaved={handleSettingsSaved}
                config={config}
              />
              </DockToolHostsProvider>
              </KnowledgeCitationActionsProvider>
              </KnowledgeMountsProvider>
              </SubagentReviewLoopProvider>
              </SubagentStopProvider>
            </SubagentInspectorProvider>
          </DesktopContextMenuProvider>
        </MediaPreviewReadProvider>
      </LocalFileActionsProvider>
      </HostLogProvider>
    </DesktopLocaleProvider>
  );
}
