/**
 * Workbench composition root: shell chrome + host/session owners + slot tree.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createHostLogStore } from './host-log-context';
import type { ThemeManifest } from '@piwin/contracts';
import { focusComposerInput } from './context-menu/desktop-context-menu-value';
import { useWorkbenchMedia } from './hooks/use-workbench-media.js';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import { useWorkbenchHostClient } from './use-workbench-host-client';
import { useSubagentReviewLoopValue } from './subagent-review-loop-context';
import { useWorkbenchShellChrome } from './hooks/use-workbench-shell-chrome';
import { useWorkbenchStableValues } from './hooks/use-workbench-stable-values';
import { useWorkbenchAppModel } from './hooks/use-workbench-app-model';
import { useShellSessionOpen } from './hooks/use-shell-session-open';
import { useWindowsShellOffer } from './hooks/use-windows-shell-offer';
import { installRendererSelfHeal } from './renderer-self-heal';
import { scheduleIdleTask } from './schedule-idle-task';
import { loadStreamdownMathPlugin } from './streamdown-math-plugin.js';
import { WorkbenchWorkspaceProviders } from './workbench-workspace-providers';
import { WorkbenchShellFrame } from './workbench-shell-slots';
import { WorkbenchShellOverlays, WorkbenchStageMounts } from './workbench-stage-slots';
import { deriveSubagentOrchestrationView } from './subagent-orchestration-view';
import { SessionContextRow } from './session-context-row';
import { WorkbenchComposerColumn } from './workbench-conversation';
import { resolveFocusedConversationSessionId } from './conversation-pane-layout';
import {
  useConversationPaneLayout,
  useConversationPaneSubscriptions,
} from './use-conversation-pane-layout';
import { isDockingWorkspaceEnabled } from './workbench/docking/flag.js';
import { useDockingWorkspace } from './workbench/docking/use-docking-workspace.js';
import {
  inspectorTabToToolKind,
  toolKindToInspectorTab,
} from './workbench/docking/docking-tool-bridge.js';
import { findViewGroupId, isStageGroupId } from './workbench/docking/topology.js';
import { sessionScopeKey } from './session-scope-key';
import { useWorkbenchKnowledge } from './hooks/use-workbench-knowledge';
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
  // KaTeX stays out of the cold start, but the first reply that mounts before
  // it loads paints without math and then reflows. Warm it once the shell is idle.
  useEffect(
    () =>
      scheduleIdleTask(() => {
        void loadStreamdownMathPlugin();
      }),
    [],
  );
  // Outside React state: a `host/log` push must not re-render this root.
  const [hostLogStore] = useState(createHostLogStore);
  const setHostLogEntries = hostLogStore.setEntries;
  const chrome = useWorkbenchShellChrome({ hostClient, state });
  const { activeSubPage, closeSubPage, desktopLocale, isOverlayPresentation, layoutMode } = chrome;
  const { openKnowledge, rightPanelOpen, rightPanelResize, rightPanelTab } = chrome;
  const { sessionListChrome, sessionListQuery, setActiveSubPage, shell, terminal } = chrome;
  const conversationPanesEnabled =
    state.activeScope.kind === 'general' || state.activeScope.kind === 'project';
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
  const requestedDockTool =
    dockingActive && rightPanelOpen ? inspectorTabToToolKind(rightPanelTab) : null;
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
    ? (dockingWorkspace.state.sessionTargetId ?? state.activeSessionId)
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
  const { activeComments, activeDocument, activeMedia, activeSessionName } = model;
  const { addExistingMediaAttachment, addWebElement, artifactCanvas, artifactThemeKey } = model;
  const { composer, composerCard, config, desktopContextMenuValue, dispatchNotification } = model;
  const { ensureSession, handleInspectSubagent, handleLocaleChange, handleOpenDocument } = model;
  const { handleOpenProject, handleResumeSession, handleSessionMenuAction } = model;
  const { handleStartNewSession, handleTrustProject, hostStatus, inspectorFileDiff } = model;
  const { openRightTab, pendingAttachments, readTranscriptMedia, recentProjects } = model;
  const { requestConfig, requestGit, requestSubAgent, sessionDocuments, setComposer } = model;
  const { subagentInspectorPanel, subagentInspectorToggle, subagentStop } = model;
  const windowsShellOffer = useWindowsShellOffer({ hostClient, config, requestConfig });
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
  const tasksActiveCount = useMemo(
    () =>
      parentSessionId
        ? deriveSubagentOrchestrationView({
            parentSessionId,
            invocations: state.subagentInvocations,
            children: state.subagentChildren,
            streams: state.subagentStreams,
          }).activeCount
        : 0,
    [parentSessionId, state.subagentInvocations, state.subagentChildren, state.subagentStreams],
  );
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
  const openReviewTab = useCallback(() => openRightTab('review'), [openRightTab]);
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
  const { mediaLibraryEpoch, handleRemixToComposer } = useWorkbenchMedia({
    streaming: state.streaming,
    addExistingMediaAttachment,
    setComposer,
    closeSubPage,
  });
  const composerColumn = (
    <WorkbenchComposerColumn
      state={state}
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
        onOpenWorktreeProject={(path) => handleOpenProject(path, { switchSession: true })}
        projectSwitchLocked={state.messages.length > 0 || state.awaitingTranscript}
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

  // Root context values. Each of these was a fresh object (or closure) on every
  // render, i.e. on every streamed token, and a changed context value makes
  // React walk the whole tree below it looking for consumers.
  const {
    requestLocalFile,
    stableInspectorToggle,
    stableInspectorPanel,
    stableKnowledgeMounts,
    stableCitationActions,
    dockToolHosts,
    inspectorShell,
    inspectorResize,
    inspectorSessionDocuments,
    inspectorComments,
    tasksContent,
  } = useWorkbenchStableValues({
    hostClient,
    subagentInspectorToggle,
    subagentInspectorPanel,
    knowledgeSupported,
    knowledge,
    setComposer,
    state,
    desktopLocale,
    activeTheme,
    artifactThemeKey,
    requestGit,
    addWebElement,
    artifactCanvas,
    activeDocument,
    inspectorFileDiff,
    activeMedia,
    shell,
    rightPanelResize,
    sessionDocuments,
    activeComments,
    handleResumeSession,
    parentSessionId,
    requestSubAgent,
    tasksChildren,
  });

  return (
    <WorkbenchWorkspaceProviders
      locale={desktopLocale}
      onLocaleChange={handleLocaleChange}
      hostLogStore={hostLogStore}
      requestLocalFile={requestLocalFile}
      mediaPreviewSessionId={state.activeSessionId}
      readMedia={readTranscriptMedia}
      desktopContextMenuValue={desktopContextMenuValue}
      inspectorToggle={stableInspectorToggle}
      inspectorPanel={stableInspectorPanel}
      dockToolHosts={dockToolHosts}
      hostClient={hostClient}
      subagentStop={subagentStop}
      reviewLoop={reviewLoop}
      knowledgeMounts={stableKnowledgeMounts}
      knowledgeCitationActions={stableCitationActions}
      onOpenReview={openReviewTab}
    >
      <WorkbenchShellFrame
        state={state}
        dispatch={dispatch}
        hostClient={hostClient}
        activeTheme={activeTheme}
        chrome={chrome}
        sessionListChrome={sessionListChrome}
        sessionListQuery={sessionListQuery}
        terminal={terminal}
        model={model}
        inspectorShell={inspectorShell}
        inspectorResize={inspectorResize}
        inspectorSessionDocuments={inspectorSessionDocuments}
        inspectorComments={inspectorComments}
        tasksContent={tasksContent}
        tasksActiveCount={tasksActiveCount}
        sessionContextRow={sessionContextRow}
        composerColumn={composerColumn}
        inkstoneStage={inkstoneStage}
        studioOpen={studioOpen}
        dockingActive={dockingActive}
        dockingEnabled={dockingEnabled}
        conversationPanesEnabled={conversationPanesEnabled}
        dockingWorkspace={dockingWorkspace}
        conversationPaneController={conversationPaneController}
        windowsShellOffer={windowsShellOffer}
        openSessionFromShell={openSessionFromShell}
        openReviewTab={openReviewTab}
        handleCreatePaneConversation={handleCreatePaneConversation}
      >
        <WorkbenchShellOverlays
          state={state}
          hostClient={hostClient}
          chrome={chrome}
          sessionListChrome={sessionListChrome}
          sessionListQuery={sessionListQuery}
          model={model}
          liveSessionId={liveSessionId}
        />
      </WorkbenchShellFrame>
      <WorkbenchStageMounts
        state={state}
        hostClient={hostClient}
        chrome={chrome}
        model={model}
        activeTheme={activeTheme}
        knowledge={knowledge}
        knowledgeSupported={knowledgeSupported}
        mediaLibraryEpoch={mediaLibraryEpoch}
        handleRemixToComposer={handleRemixToComposer}
        onThemeApplied={onThemeApplied}
      />
    </WorkbenchWorkspaceProviders>
  );
}
