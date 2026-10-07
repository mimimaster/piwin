/**
 * Shell assembly: the app-shell element and the regions of `WorkspaceShell`.
 *
 * Extracted from `AppWorkbench` so the composition root reads as hook
 * orchestration plus thin assembly. The region props and their sources are
 * unchanged — the same hook results the root assembled are passed through.
 */
import type { Dispatch, ReactNode } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { artifactFenceSecurityProps } from './artifact-fence-security';
import type { ChatUiAction, ChatUiState } from './chat-ui-types';
import { useWorkbenchAppModel } from './hooks/use-workbench-app-model';
import type { WorkbenchShellChrome } from './hooks/use-workbench-shell-chrome';
import type { useShellSessionOpen } from './hooks/use-shell-session-open';
import type { useWindowsShellOffer } from './hooks/use-windows-shell-offer';
import type { HostClient } from './host-client';
import { memoWithLatestCallbacks } from './memo-with-latest-callbacks';
import type { useConversationPaneLayout } from './use-conversation-pane-layout';
import type { useDockingWorkspace } from './workbench/docking/use-docking-workspace';
import { WorkbenchContextBar } from './workbench-context-bar';
import { WorkbenchPermissionBar, WorkbenchTranscript } from './workbench-conversation';
import { WorkbenchInspector } from './workbench-inspector';
import { WorkbenchSidebar } from './workbench-sidebar';
import { WorkbenchStageLayer } from './workbench-stage-slots';
import { WorkspaceShell } from './workspace-shell';

type AppModel = ReturnType<typeof useWorkbenchAppModel>;

export type WorkbenchShellFrameProps = {
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  hostClient: HostClient;
  activeTheme: ThemeManifest;
  chrome: WorkbenchShellChrome;
  sessionListChrome: WorkbenchShellChrome['sessionListChrome'];
  sessionListQuery: WorkbenchShellChrome['sessionListQuery'];
  terminal: WorkbenchShellChrome['terminal'];
  model: AppModel;
  inspectorShell: WorkbenchShellChrome['shell'];
  inspectorResize: WorkbenchShellChrome['rightPanelResize'];
  inspectorSessionDocuments: AppModel['sessionDocuments'];
  inspectorComments: AppModel['activeComments'];
  tasksContent: ReactNode;
  tasksActiveCount: number;
  sessionContextRow: ReactNode;
  composerColumn: ReactNode;
  inkstoneStage: boolean;
  studioOpen: boolean;
  dockingActive: boolean;
  dockingEnabled: boolean;
  conversationPanesEnabled: boolean;
  dockingWorkspace: ReturnType<typeof useDockingWorkspace>;
  conversationPaneController: ReturnType<typeof useConversationPaneLayout>;
  windowsShellOffer: ReturnType<typeof useWindowsShellOffer>;
  openSessionFromShell: ReturnType<typeof useShellSessionOpen>;
  openReviewTab: () => void;
  handleCreatePaneConversation: (paneId: string) => Promise<string | null>;
  children?: ReactNode;
};

const StableWorkbenchInspector = memoWithLatestCallbacks(WorkbenchInspector, {
  isHandler: (key) => /^(on|handle)[A-Z]/.test(key) || key === 'openSettingsSection',
});

export function WorkbenchShellFrame(props: WorkbenchShellFrameProps) {
  const { state, dispatch, hostClient, activeTheme } = props;
  const { chrome, sessionListChrome, sessionListQuery, terminal, model } = props;
  const { inspectorShell, inspectorResize, inspectorSessionDocuments } = props;
  const { inspectorComments, tasksContent, tasksActiveCount } = props;
  const { sessionContextRow, composerColumn, inkstoneStage, studioOpen } = props;
  const { dockingActive, dockingEnabled, conversationPanesEnabled } = props;
  const { dockingWorkspace, conversationPaneController, windowsShellOffer } = props;
  const { openSessionFromShell, openReviewTab, handleCreatePaneConversation } = props;

  const { activeSubPage, appShellStyle, desktopLocale, editingMessageId, inspectorOverlay } =
    chrome;
  const { inspectorPlacement, isOverlayPresentation, layoutMode, navDrawerOpen } = chrome;
  const { openFlashcards, openImages, openKnowledge, openLibrary, openMarketplace } = chrome;
  const { openVideos, preferences, rightPanelOpen, rightPanelResize, rightPanelTab } = chrome;
  const { setActiveSubPage, setEditingMessageId, setRightPanelView, setSidebarMode } = chrome;
  const { settingsOpen, shell, showOverlayScrim, sidebarMode, sidebarResize } = chrome;
  const { openSessionMenu, openSessionSearch, requestDeleteSession } = sessionListChrome;
  const { sessionListOrder, sessionMenu, sessionSearch } = sessionListChrome;
  const { setShowArchivedSessions, showArchivedSessions } = sessionListChrome;
  const { filteredGeneralSessions, filteredSessions, sessionGroups } = sessionListQuery;
  const { handleTerminalCwdChange, ptyOutput, setPtyOutput, terminalCwd, terminalRecentDirs } =
    terminal;
  const { activeDocument, activeDraftId, activeMedia, activeSessionName } = model;
  const { activeSessionOrigin, activitySignal, addContextRef, addWebElement } = model;
  const { artifactCanvas, artifactThemeKey, assemblySummariesByRunId } = model;
  const { backendServiceSessionIds, branchPoints, branchResend, composerCard } = model;
  const { composerLayoutMode, config, continueTurn, dispatchNotification, draftAgentId } = model;
  const { draftAgentOptions, draftSessions, effectiveRunMode, enqueueAttachmentFile } = model;
  const { extensionUiRequest, fileBrowseRoot, forkCountsByMessageId, handleAbort } = model;
  const { handleAddDocComment, handleArtifactAction, handleCancelMessageEdit } = model;
  const { handleCancelWalkthrough, handleCommentLine, handleCompactAbort } = model;
  const { handleDeleteDocComment, handleEditAndResendMessage, handleEditDocComment } = model;
  const { handleExtensionUiResolve, handleForkSession, handleGenerateWalkthrough } = model;
  const { handleInspectSubagent, handleInterventionCancel, handleInterventionEdit } = model;
  const { handleJumpToHistoryAnchor, handleJumpToTranscriptMessage } = model;
  const { handleLoadNewerTranscript, handleLoadOlderTranscript, handleMessageFeedback } = model;
  const { handleOpenArtifactCanvas, handleOpenDiff, handleOpenDocument, handleOpenProject } = model;
  const { handleOpenWorkspaceClick, handlePermission, handlePlanAction, handlePlanExecute } = model;
  const { handleRemoveProjectFromSidebar, handleResumeDraft, handleResumeSession } = model;
  const { handleRetryMessage, handleReturnToLiveTranscript, handleSend } = model;
  const { handleSessionListOrderChange, handleSessionMenuAction, handleStartNewSession } = model;
  const { handleToggleAppearance, historyViewActive, hostStatus, hydrateSessions } = model;
  const { inspectorFileDiff, jobs, lastUserMessage, lastUserMessageId, modelOptions } = model;
  const { onDraftAgentChange, openRightTab, openSettingsSection } = model;
  const { recentProjects, requestCardsPanel, requestFileTree, requestGit } = model;
  const { requestKnowledgeCenter, requestNotesPanel, requestPty } = model;
  const { resolveConversationFlashcards, retryTurn, runStatus, sessionLineage, sessionPlan } =
    model;
  const { setComposer, switchBranch, terminalJobMonitor, transcriptHistoryLoading } = model;
  const { visibleRunRecordsById, visibleTranscriptMessages, worktrees } = model;

  return (
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
        workspaceClassName={settingsOpen || studioOpen ? 'settings-workspace-suspended' : undefined}
        sidebar={
          <WorkbenchSidebar
            state={state}
            hostClient={hostClient}
            hostStatus={hostStatus}
            recentProjects={recentProjects}
            worktrees={worktrees}
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
            onOpenWorktreeProject={(path) => handleOpenProject(path, { switchSession: true })}
            onRemoveProject={handleRemoveProjectFromSidebar}
            onNewSession={(options) => {
              setActiveSubPage(null);
              if (isOverlayPresentation) shell.closeOverlay();
              return handleStartNewSession(options);
            }}
            onResumeSession={openSessionFromShell}
            onResumeDraft={(draftId) => {
              setActiveSubPage(null);
              if (isOverlayPresentation) shell.closeOverlay();
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
            onRetryLastUser={(messageId) => void retryTurn(messageId, { keepPrevious: false })}
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
          <WorkbenchStageLayer
            primaryPane={primaryPane}
            state={state}
            dispatch={dispatch}
            hostClient={hostClient}
            activeTheme={activeTheme}
            chrome={chrome}
            model={model}
            windowsShellOffer={windowsShellOffer}
            dockingEnabled={dockingEnabled}
            dockingWorkspace={dockingWorkspace}
            conversationPanesEnabled={conversationPanesEnabled}
            conversationPaneController={conversationPaneController}
            openSessionFromShell={openSessionFromShell}
            handleCreatePaneConversation={handleCreatePaneConversation}
          />
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
              state.activeScope.kind === 'general' ? state.generalSessions : state.sessions
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
            onLoadEarlierWork={handleJumpToTranscriptMessage}
            onReturnToLatest={handleReturnToLiveTranscript}
            onLoadOlder={handleLoadOlderTranscript}
            onLoadNewer={handleLoadNewerTranscript}
            onOpenReview={openReviewTab}
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
            draftAgentOptions={draftAgentOptions}
            draftAgentId={draftAgentId}
            onSelectDraftAgent={onDraftAgentChange}
            onOpenAgentSettings={() => openSettingsSection('agent')}
            {...(sessionPlan ? { sessionPlan } : {})}
          />
        }
        permissionBar={
          <WorkbenchPermissionBar
            state={state}
            sidebarMode={sidebarMode}
            extensionUiRequest={extensionUiRequest}
            sessionPlan={sessionPlan}
            onPlanAction={handlePlanAction}
            onOpenDocument={handleOpenDocument}
            onPermission={handlePermission}
            onExtensionUiResolve={handleExtensionUiResolve}
          />
        }
        composerDock={studioOpen ? null : composerColumn}
        rightPanel={
          <StableWorkbenchInspector
            showOverlayScrim={showOverlayScrim}
            shell={inspectorShell}
            rightPanelOpen={rightPanelOpen}
            rightPanelTab={rightPanelTab}
            rightPanelResize={inspectorResize}
            isOverlayPresentation={inspectorOverlay}
            runningJobCount={jobs.length}
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
            sessionDocuments={inspectorSessionDocuments}
            handleOpenDocument={handleOpenDocument}
            handleCommentLine={handleCommentLine}
            activeComments={inspectorComments}
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
            tasksContent={tasksContent}
          />
        }
      />
      {props.children}
    </div>
  );
}
