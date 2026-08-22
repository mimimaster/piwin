/**
 * Workbench composition root: shell chrome + host/session owners + slot tree.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import { useWorkbenchHostClient } from './use-workbench-host-client';
import { MediaPreviewReadProvider } from './media-preview-read-context';
import type { HostLogEntry } from './HostLogPanel';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { DesktopContextMenuProvider } from './context-menu';
import { SubagentInspectorProvider } from './subagent-inspector-context';
import { useWorkbenchShellChrome } from './hooks/use-workbench-shell-chrome';
import { useWorkbenchAppModel } from './hooks/use-workbench-app-model';
import { installRendererSelfHeal } from './renderer-self-heal';
import { WorkspaceShell } from './workspace-shell';
import { WorkbenchInspector } from './workbench-inspector';
import {
  WorkbenchComposerColumn,
  WorkbenchPermissionBar,
  WorkbenchTranscript,
} from './workbench-conversation';
import { WorkbenchContextBar } from './workbench-context-bar';
import { WorkbenchKnowledgeStage } from './workbench-knowledge-stage';
import { WorkbenchOverlays, WorkbenchSettingsOverlay } from './workbench-overlays';
import { WorkbenchSidebar } from './workbench-sidebar';
import { WorkbenchStatusBar } from './workbench-status-bar';

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
  const [, setHostLogEntries] = useState<HostLogEntry[]>([]);
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
    isOverlayPresentation,
    sidebarResize,
    rightPanelResize,
    setRightPanelView,
    knowledgeOpen,
    setKnowledgeOpen,
    handleOpenCardsPanel,
    sessionListChrome,
    sessionListQuery,
    editingMessageId,
    setEditingMessageId,
    preferences,
    terminal,
    appShellStyle,
    desktopLocale,
    foregroundReplaceConfirm,
    plusMenu,
  } = chrome;
  const {
    sessionSearch,
    setSessionSearch,
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
  const { menuSkills, menuMcp } = plusMenu;

  const model = useWorkbenchAppModel({
    hostClient,
    state,
    dispatch,
    chrome,
    activeTheme,
    onThemeApplied,
    setHostLogEntries,
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
    backendServiceSessionIds,
    hostStatus,
    config,
    setActivePet,
    sessionPlan,
    extensionUiRequest,
    assemblySummariesByRunId,
    inspectorFileDiff,
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
    pendingTruncate,
    confirmTruncateAfter,
    cancelTruncateAfter,
    pendingSwitchConfirm,
    confirmSwitchBranch,
    cancelSwitchBranch,
    handleSessionListOrderChange,
    handleSettingsOpenSubagentSession,
    recentProjects,
    handleRemoveProjectFromSidebar,
    effectiveRunMode,
    handleSettingsSaved,
    handleSettingsPreferencesChange,
    selectedModelLabel,
    selectedModelContextWindow,
    currentPromptModelRef,
    composer,
    setComposer,
    pendingAttachments,
    draftSessions,
    activeDraftId,
    addWebElement,
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
    contextUsagePercent,
    lastUserMessage,
    lastUserMessageId,
    activeSessionName,
    activeSessionOrigin,
    composerCard,
    composerLayoutMode,
    handleInspectSubagent,
    subagentInspectorToggle,
    subagentInspectorPanel,
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
  selfHealBusyRef.current =
    state.streaming ||
    state.compacting ||
    composer.trim().length > 0 ||
    pendingAttachments.length > 0;

  return (
    <DesktopLocaleProvider locale={desktopLocale} onLocaleChange={handleLocaleChange}>
      <MediaPreviewReadProvider sessionId={state.activeSessionId} readMedia={readTranscriptMedia}>
      <DesktopContextMenuProvider value={desktopContextMenuValue}>
      <SubagentInspectorProvider toggle={subagentInspectorToggle} panel={subagentInspectorPanel}>
        <div
          className={`app-shell workbench${rightPanelOpen ? ' has-right-panel' : ''}${navDrawerOpen ? ' nav-open' : ''}${settingsOpen ? ' settings-open' : ''}${knowledgeOpen ? ' knowledge-open' : ''}${rightPanelResize.isResizing || sidebarResize.isResizing ? ' is-resizing-panels' : ''}`}
          style={appShellStyle}
          data-testid="app-shell"
          data-layout={layoutMode}
          data-right={rightPanelOpen ? 'expanded' : 'collapsed'}
          data-settings-open={settingsOpen ? 'true' : 'false'}
          data-knowledge-open={knowledgeOpen ? 'true' : 'false'}
        >
          <WorkspaceShell
            workspaceClassName={settingsOpen ? 'settings-workspace-suspended' : undefined}
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
                onSessionSearchChange={setSessionSearch}
                showArchivedSessions={showArchivedSessions}
                setShowArchivedSessions={setShowArchivedSessions}
                hydrateSessions={hydrateSessions}
                settingsOpen={settingsOpen}
                knowledgeOpen={knowledgeOpen}
                setKnowledgeOpen={setKnowledgeOpen}
                onOpenWorkspace={handleOpenWorkspaceClick}
                onOpenProject={handleOpenProject}
                onRemoveProject={handleRemoveProjectFromSidebar}
                onNewSession={handleStartNewSession}
                onResumeSession={handleResumeSession}
                onResumeDraft={handleResumeDraft}
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
                sessionsExpanded={navDrawerOpen}
                shell={shell}
              />
            }
            contextBar={
              <WorkbenchContextBar
                state={state}
                recentProjects={recentProjects}
                activeSessionName={activeSessionName}
                activeSessionOrigin={activeSessionOrigin}
                sessionLineage={sessionLineage}
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
                onRetryLastUser={branchResend}
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
            knowledgePanel={
              knowledgeOpen ? (
                <WorkbenchKnowledgeStage
                  locale={desktopLocale}
                  projectPath={state.projectPath}
                  recentProjects={recentProjects}
                  request={requestKnowledgeCenter}
                  onOpenSession={handleResumeSession}
                  onOpenCardsPanel={handleOpenCardsPanel}
                  onConfigureEmbedding={() => openSettingsSection('knowledge')}
                  setKnowledgeOpen={setKnowledgeOpen}
                  setComposer={setComposer}
                />
              ) : undefined
            }
            transcript={
              <WorkbenchTranscript
                locale={desktopLocale}
                hostClient={hostClient}
                state={state}
                dispatch={dispatch}
                visibleMessages={visibleTranscriptMessages}
                visibleRunRecordsById={visibleRunRecordsById}
                historyViewActive={historyViewActive}
                activitySignal={activitySignal}
                transcriptHistoryLoading={transcriptHistoryLoading}
                lastUserMessageId={lastUserMessageId}
                composerCard={composerCard}
                config={config}
                preferences={preferences}
                sessionPlan={sessionPlan}
                currentPromptModel={currentPromptModelRef}
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
                onBranchResend={branchResend}
                onSwitchBranch={switchBranch}
                onInterventionEdit={handleInterventionEdit}
                onInterventionCancel={handleInterventionCancel}
                onFeedback={handleMessageFeedback}
                onArtifactAction={handleArtifactAction}
                onOpenArtifactCanvas={handleOpenArtifactCanvas}
                onOpenDocument={handleOpenDocument}
                onOpenDiff={handleOpenDiff}
                onPlanExecute={handlePlanExecute}
                onPlanAbort={handlePlanAbort}
                onGenerateWalkthrough={handleGenerateWalkthrough}
                onCancelWalkthrough={handleCancelWalkthrough}
                onForkFromMessage={handleForkSession}
                onOpenSession={handleResumeSession}
                onCompactAbort={handleCompactAbort}
              />
            }
            permissionBar={
              <WorkbenchPermissionBar
                state={state}
                extensionUiRequest={extensionUiRequest}
                onPermission={handlePermission}
                onExtensionUiResolve={handleExtensionUiResolve}
              />
            }
            composerDock={
              <WorkbenchComposerColumn
                state={state}
                activeTheme={activeTheme}
                activeSessionName={activeSessionName}
                composerCard={composerCard}
                onTrustProject={handleTrustProject}
                onUnarchiveSession={(sessionId) =>
                  void handleSessionMenuAction(sessionId, 'unarchive')
                }
                onNewSession={handleStartNewSession}
              />
            }
            statusBar={
              <WorkbenchStatusBar
                modelLabel={selectedModelLabel}
                streaming={state.streaming}
                error={state.error}
                terminalAttention={terminalAttention}
                isConversationSession={state.activeScope.kind === 'general'}
                skillsCount={menuSkills.filter((s) => s.enabled).length}
                mcpCount={menuMcp.filter((m) => m.running).length}
                contextUsagePercent={contextUsagePercent}
                contextUsage={state.contextUsage}
                modelContextWindow={selectedModelContextWindow}
                openSettingsSection={openSettingsSection}
                locale={desktopLocale}
              />
            }
            rightPanel={
              <WorkbenchInspector
                showOverlayScrim={showOverlayScrim}
                shell={shell}
                rightPanelOpen={rightPanelOpen}
                rightPanelTab={rightPanelTab}
                rightPanelResize={rightPanelResize}
                isOverlayPresentation={isOverlayPresentation}
                runningJobCount={jobs.length}
                terminalAttention={terminalAttention}
                onTerminalAttentionClear={() => setTerminalAttention(false)}
                onViewChange={setRightPanelView}
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
                projectTrusted={state.projectTrusted}
                activeSessionId={state.activeSessionId}
                walkthroughsByMessageId={state.walkthroughsByMessageId}
                addContextRef={addContextRef}
                dispatchNotification={dispatchNotification}
                handleSend={handleSend}
                setComposer={setComposer}
                artifactTarget={artifactCanvas.activeTarget}
                artifactThemeKey={artifactThemeKey}
                {...(config?.artifact?.maxBytes !== undefined
                  ? { artifactMaxBytes: config.artifact.maxBytes }
                  : {})}
                addWebElement={addWebElement}
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
                branchPoints={branchPoints}
                onSwitchBranch={switchBranch}
                streaming={state.streaming}
              />
            }
          />

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
            showArchivedSessions={showArchivedSessions}
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
          />

        </div>
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
      </SubagentInspectorProvider>
      </DesktopContextMenuProvider>
      </MediaPreviewReadProvider>
    </DesktopLocaleProvider>
  );
}
