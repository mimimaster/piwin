import { canLoadOlderTranscript, canLoadNewerTranscript } from './transcript-history-window.js';
/**
 * Conversation column of the desktop workbench (extracted from App.tsx).
 * Host commands stay with App; this file owns transcript, permission, and
 * composer-dock chrome.
 */
import { useMemo, type ReactElement } from 'react';
import type {
  ContextSummaryPush,
  FlashcardReviewCard,
  PermissionDecision,
  PermissionRememberScope,
  PiwinConfig,
  PlanDisplayPayload,
  PlanExecutionMode,
  ProductSessionLineageView,
  SessionPlan,
  ThemeManifest,
  TranscriptBranchPoint,
} from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import { artifactFenceSecurityProps } from './artifact-fence-security';
import { artifactSurfaceProps, resolveArtifactSurfacesForScope } from './artifact-surfaces';
import { ChatThread } from './chat-thread';
import { memoWithLatestCallbacks } from './memo-with-latest-callbacks';
import type { ChatMessageUi, ChatUiState, SessionListItemUi } from './chat-reducer';
import { ComposerDock, type ComposerDockProps } from './composer-dock';
import type { DesktopLocale } from './desktop-locale';
import { EmptyStageLanding } from './empty-stage-landing';
import { ExtensionUiPrompt, type ExtensionUiResolvePayload } from './extension-ui-prompt';
import type { HostClient } from './host-client';
import { HostReconnectBanner } from './host-reconnect-banner';
import { shouldShowHostReconnectBanner } from './host-reconnect-gate.js';
import type { DoccardsHostRequest } from './knowledge/knowledge-host-request';
import type { ModelOption } from './model-options';
import { PermissionBar } from './permission-bar';
import { shouldShowPlanTodoTray, type PlanTrayAction } from './plan-todo-model.js';
import { PlanTodoTray } from './plan-todo-tray.js';
import { ProjectTrustNotice } from './project-trust-notice';
import { SessionArchivedBanner } from './session-archived-banner';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { DocumentOpenInput } from './tool-call-card';
import { TranscriptViewport, type TranscriptViewportProps } from './transcript-viewport';
import { ToolOutputReaderContext, createHostToolOutputReader } from './tool-output-reader.js';
import type { DesktopPreferences } from './ui-preferences';
import type { ExtensionUiRequestState } from './hooks/use-host-bootstrap';
import { isConversationSessionChrome } from './is-conversation-session';
import type { SidebarMode } from './sidebar-mode';

/**
 * Workbench parents rebuild inline handlers on every chat reducer commit, so a
 * plain ChatThread re-rendered the whole transcript — and every mounted row —
 * on each streamed token. The boundary hands ChatThread one stable proxy per
 * handler; data props (messages, streaming, composerCard) still decide renders.
 */
const StableChatThread = memoWithLatestCallbacks(ChatThread);

export type WorkbenchTranscriptProps = {
  locale: DesktopLocale;
  hostClient: HostClient;
  state: ChatUiState;
  visibleMessages: ChatMessageUi[];
  visibleRunRecordsById: ChatUiState['runRecordsById'];
  historyViewActive: boolean;
  activitySignal: string;
  transcriptHistoryLoading: boolean;
  lastUserMessageId: string | null;
  composerCard: ComposerDockProps;
  config: PiwinConfig | null;
  preferences: DesktopPreferences;

  modelOptions: ModelOption[];
  requestKnowledgeCenter: DoccardsHostRequest;
  resolveFlashcards: (itemIds: string[]) => Promise<FlashcardReviewCard[]>;
  requestGit: HostClient['request'];
  editingMessageId: string | null;
  activeTheme: ThemeManifest;
  artifactThemeKey: string;
  assemblySummariesByRunId: Record<string, ContextSummaryPush>;
  sessionLineage: ProductSessionLineageView | null | undefined;
  forkCountsByMessageId: Record<string, number>;
  branchPoints: TranscriptBranchPoint[];
  onJumpToHistoryAnchor: NonNullable<TranscriptViewportProps['onJumpToHistoryAnchor']>;
  onReturnToLatest: () => void;
  /** `keepMessageId`: the message on screen, which window eviction must keep. */
  onLoadOlder: (keepMessageId?: string) => Promise<void>;
  onLoadNewer: (keepMessageId?: string) => Promise<void>;
  onOpenReview: () => void;
  onPermission: (
    decision: PermissionDecision,
    scope?: PermissionRememberScope,
  ) => void | Promise<void>;
  onInspectSubagent: (selection: SubagentInspectorSelection) => void;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  onRetryTurn?: (userMessageId: string, options: { keepPrevious: boolean }) => void;
  onContinueTurn?: () => void;
  onBranchResend: (messageId: string, text: string) => void;
  onSwitchBranch: (headMessageId: string) => void;
  onInterventionEdit: (messageId: string, text: string) => void | Promise<void>;
  onInterventionCancel: (messageId: string) => void | Promise<void>;
  onFeedback: (message: string, level: 'info' | 'success' | 'error') => void;
  onArtifactAction: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas: (target: ArtifactCanvasTarget) => void;
  onOpenDocument: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  onOpenDiff: (absolutePath: string, relativePath?: string) => void;
  /** Project root, or the General workspace when Chat has no project. */
  fileBrowseRoot?: string | null;

  onGenerateWalkthrough: (messageId: string, force?: boolean) => void | Promise<void>;
  onCancelWalkthrough: (messageId: string, generationId?: string) => void | Promise<void>;
  onForkFromMessage: (sessionId: string, messageId: string) => void | Promise<void>;
  onOpenSession: (sessionId: string) => void | Promise<void>;
  onCompactAbort: () => void | Promise<void>;
  onPlanExecute?: (
    display: PlanDisplayPayload,
    mode: PlanExecutionMode,
  ) => void | Promise<void>;
  sessionPlan?: SessionPlan | null;
  /** Scope-matched sessions offered as resume targets on an empty stage. */
  scopeSessions: readonly SessionListItemUi[];
  onOpenAllSessions?: () => void;
  runningSessionIds?: Record<string, boolean | true>;
  sidebarMode: SidebarMode;
};

export function WorkbenchTranscript(props: WorkbenchTranscriptProps): ReactElement {
  const {
    locale,
    hostClient,
    state,
    visibleMessages,
    visibleRunRecordsById,
    historyViewActive,
    activitySignal,
    transcriptHistoryLoading,
    lastUserMessageId,
    composerCard,
    config,
    preferences,
    modelOptions,
    requestKnowledgeCenter,
    resolveFlashcards,
    requestGit,
    editingMessageId,
    activeTheme,
    artifactThemeKey,
    assemblySummariesByRunId,
    sessionLineage,
    forkCountsByMessageId,
    branchPoints,
    onJumpToHistoryAnchor,
    onReturnToLatest,
    onLoadOlder,
    onLoadNewer,
    onOpenReview,
    onPermission,
    onInspectSubagent,
    onEdit,
    onCancelEdit,
    onEditResend,
    onRetry,
    onRetryTurn,
    onContinueTurn,
    onBranchResend,
    onSwitchBranch,
    onInterventionEdit,
    onInterventionCancel,
    onFeedback,
    onArtifactAction,
    onOpenArtifactCanvas,
    onOpenDocument,
    onOpenDiff,
    fileBrowseRoot,

    onGenerateWalkthrough,
    onCancelWalkthrough,
    onForkFromMessage,
    onOpenSession,
    onCompactAbort,
    onPlanExecute,
    sessionPlan,
    scopeSessions,
    sidebarMode,
  } = props;
  const activeSessionId = state.activeSessionId;
  const isConversationSession = isConversationSessionChrome(state.activeScope, sidebarMode);
  const canReadToolOutput = hostClient.supportsCommand('session/tool-output');
  // Historical tool rows fetch their slimmed output on expand (session-scoped cache).
  const toolOutputReader = useMemo(
    () =>
      activeSessionId && canReadToolOutput
        ? createHostToolOutputReader((command) => hostClient.request(command), activeSessionId)
        : null,
    [activeSessionId, canReadToolOutput, hostClient],
  );

  return (
    <ToolOutputReaderContext.Provider value={toolOutputReader}>
      {shouldShowHostReconnectBanner({
        transport: hostClient.getTransport(),
        wireReady: hostClient.isReady(),
      }) ? (
        <HostReconnectBanner locale={locale} />
      ) : null}
      <div className="transcript-stage">
        <TranscriptViewport
          key={activeSessionId ?? 'no-session'}
        awaitingTranscript={state.awaitingTranscript}
        messageCount={visibleMessages.length}
        activitySignal={historyViewActive ? 'history-view' : activitySignal}
        messages={visibleMessages}
        historyIndex={state.userMessageIndex}
        onJumpToHistoryAnchor={onJumpToHistoryAnchor}
        historyViewActive={historyViewActive}
        onReturnToLatest={onReturnToLatest}
        canLoadOlder={canLoadOlderTranscript(state)}
        canLoadNewer={canLoadNewerTranscript(state)}
        onLoadNewer={onLoadNewer}
        historyLoading={transcriptHistoryLoading}
        onLoadOlder={onLoadOlder}
        locale={locale}
        liveTurnId={!historyViewActive && state.streaming ? lastUserMessageId : null}
        {...(activeSessionId ? { sessionId: activeSessionId } : {})}
      >
        {/*
         * Keep the thread mounted during the pre-ACK window. The
         * optimistic send marks the run as streaming before the
         * Host returns a run id, and ChatThread owns the waiting
         * activity locator for that state.
         */}
        {visibleMessages.length > 0 || (!historyViewActive && state.streaming) ? (
          <StableChatThread
            messages={visibleMessages}
            {...(activeSessionId ? { sessionId: activeSessionId } : {})}
            hydrating={state.awaitingTranscript}
            streaming={!historyViewActive && state.streaming}
            activeSessionId={activeSessionId}
            docCardRequest={requestKnowledgeCenter as never}
            isConversationSession={isConversationSession}
            onResolveFlashcards={resolveFlashcards}
            livePromptModel={state.pendingTurnModel}
            modelOptions={modelOptions}
            {...(config?.providers !== undefined ? { configProviders: config.providers } : {})}
            contextUsage={state.contextUsage}
            editingMessageId={editingMessageId}
            lastUserMessageId={lastUserMessageId}
            activeTheme={activeTheme}
            artifactThemeKey={artifactThemeKey}
            runRecordsById={visibleRunRecordsById}
            activeRunId={historyViewActive ? null : state.activeRunId}
            activeSkill={historyViewActive ? null : state.activeSkill}
            {...(preferences.agentLocatorAnimation
              ? { agentLocatorAnimation: preferences.agentLocatorAnimation }
              : {})}
            permissionPrompt={state.permissionPrompt}
            projectPath={fileBrowseRoot ?? state.projectPath}
            {...(hostClient.supportsCommand('git/diff-file')
              ? { toolDiffRequest: requestGit as never }
              : {})}
            {...(hostClient.supportsCommand('git/diff-summary')
              ? { filesChangedRequest: requestGit as never }
              : {})}
            onReviewChanges={onOpenReview}
            onPermission={(decision, scope) => {
              void onPermission(decision, scope);
            }}
            workDetailsExpanded={preferences.workDetailsExpanded}
            toolDensity={preferences.toolDensity}
            showThinking={preferences.verboseAgentChat}
            {...artifactSurfaceProps(
              resolveArtifactSurfacesForScope(config?.artifact, state.activeScope),
            )}
            artifactCodeFirst={preferences.artifactCodeFirst}
            {...artifactFenceSecurityProps(config?.artifact)}
            locale={locale}
            assemblySummariesByRunId={assemblySummariesByRunId}
            onInspectSubagent={onInspectSubagent}
            subagentChildren={state.subagentChildren}
            subagentInvocations={state.subagentInvocations}
            subagentStreams={state.subagentStreams}
            onEdit={onEdit}
            onCancelEdit={onCancelEdit}
            onEditResend={onEditResend}
            onRetry={onRetry}
            {...(onRetryTurn !== undefined ? { onRetryTurn } : {})}
            {...(onContinueTurn !== undefined ? { onContinueTurn } : {})}
            onBranchResend={onBranchResend}
            branchPoints={branchPoints}
            onSwitchBranch={onSwitchBranch}
            onInterventionEdit={onInterventionEdit}
            onInterventionCancel={onInterventionCancel}
            onFeedback={onFeedback}
            onArtifactAction={onArtifactAction}
            onOpenArtifactCanvas={onOpenArtifactCanvas}
            onOpenDocument={onOpenDocument}
            {...(hostClient.supportsCommand('project/read-file')
              ? {
                  onOpenFile: (absolutePath: string, relativePath?: string) => {
                    onOpenDocument(
                      {
                        title:
                          (relativePath || absolutePath).split(/[\\/]/).pop() ||
                          absolutePath,
                        path: absolutePath,
                      },
                      'inspector',
                    );
                  },
                }
              : {})}
            onOpenDiff={onOpenDiff}
            compactionActivity={state.compactionActivity}
            onCompactAbort={onCompactAbort}
            composerCard={composerCard}
            walkthroughsByMessageId={state.walkthroughsByMessageId}
            walkthroughEnabled={config?.walkthrough?.enabled !== false}
            walkthroughAutoGenerate={false}
            onGenerateWalkthrough={onGenerateWalkthrough}
            onCancelWalkthrough={onCancelWalkthrough}
            {...(activeSessionId
              ? {
                  onForkFromMessage: (messageId: string) =>
                    void onForkFromMessage(activeSessionId, messageId),
                }
              : {})}
            {...(sessionLineage ? { sessionLineage } : {})}
            forkCountsByMessageId={forkCountsByMessageId}
            onOpenSession={(sessionId: string) => void onOpenSession(sessionId)}
            derivedActionsDisabled={!activeSessionId || state.streaming || state.awaitingTranscript}
            {...(onPlanExecute ? { onPlanExecute } : {})}
            {...(sessionPlan ? { sessionPlan } : {})}
          />
        ) : (
          <EmptyStageLanding
            locale={locale}
            sessions={scopeSessions}
            onResumeSession={(sessionId) => void onOpenSession(sessionId)}
            {...(props.onOpenAllSessions ? { onOpenAllSessions: props.onOpenAllSessions } : {})}
            {...(props.runningSessionIds ? { runningSessionIds: props.runningSessionIds } : {})}
          />
        )}
        </TranscriptViewport>
      </div>
    </ToolOutputReaderContext.Provider>
  );
}

export type WorkbenchPermissionBarProps = {
  state: ChatUiState;
  sidebarMode: SidebarMode;
  extensionUiRequest: ExtensionUiRequestState | null;
  sessionPlan?: SessionPlan | null;
  onPlanAction?: (action: PlanTrayAction) => void | Promise<void>;
  onOpenDocument?: (doc: DocumentOpenInput) => void;
  onPermission: (
    decision: PermissionDecision,
    scope?: PermissionRememberScope,
  ) => void | Promise<void>;
  onExtensionUiResolve: (payload: ExtensionUiResolvePayload) => void | Promise<void>;
};

function permissionOriginProps(
  state: ChatUiState,
  sessionId: string,
): { origin?: NonNullable<import('./permission-bar').PermissionBarProps['origin']> } {
  if (!sessionId || sessionId === state.activeSessionId) return {};
  const child = state.subagentChildren[sessionId];
  if (child) {
    return {
      origin: {
        kind: 'subagent',
        name: child.name?.trim() || sessionId,
        ...(child.workingDirectory ? { workingDirectory: child.workingDirectory } : {}),
      },
    };
  }
  const session = state.sessions.find((item) => item.id === sessionId);
  return { origin: { kind: 'session', name: session?.name?.trim() || sessionId } };
}

export function WorkbenchPermissionBar(
  props: WorkbenchPermissionBarProps,
): ReactElement | null {
  const {
    state,
    sidebarMode,
    extensionUiRequest,
    sessionPlan,
    onPlanAction,
    onOpenDocument,
    onPermission,
    onExtensionUiResolve,
  } = props;
  const isConversationSession = isConversationSessionChrome(state.activeScope, sidebarMode);
  const visiblePermissionQueue = state.permissionQueue.filter((prompt) => {
    if (!state.activeSessionId) return false;
    if (prompt.sessionId === state.activeSessionId) return true;
    return state.subagentChildren[prompt.sessionId]?.parentSessionId === state.activeSessionId;
  });
  const visiblePermissionPrompt = visiblePermissionQueue[0] ?? null;
  const tray =
    sessionPlan && shouldShowPlanTodoTray({ plan: sessionPlan, isConversationSession }) ? (
      <PlanTodoTray
        plan={sessionPlan}
        {...(onOpenDocument ? { onOpenDocument } : {})}
        {...(onPlanAction ? { onAction: onPlanAction } : {})}
      />
    ) : null;

  let interruption: ReactElement | null = null;
  if (visiblePermissionPrompt) {
    interruption = (
      <PermissionBar
        key={visiblePermissionPrompt.requestId}
        prompt={visiblePermissionPrompt}
        projectPath={state.projectPath}
        queuedRemaining={Math.max(0, visiblePermissionQueue.length - 1)}
        {...permissionOriginProps(state, visiblePermissionPrompt.sessionId)}
        onPermission={(decision, scope) => {
          void onPermission(decision, scope);
        }}
      />
    );
  } else if (!isConversationSession && extensionUiRequest) {
    interruption = (
      <ExtensionUiPrompt
        request={extensionUiRequest}
        onResolve={(payload) => void onExtensionUiResolve(payload)}
      />
    );
  }

  if (!tray && !interruption) return null;
  return (
    <div className="composer-plan-stack">
      {tray}
      {interruption}
    </div>
  );
}

export type WorkbenchComposerColumnProps = {
  state: ChatUiState;
  activeSessionName: string;
  composerCard: ComposerDockProps;
  onTrustProject: (trust: boolean) => void | Promise<void>;
  onUnarchiveSession: (sessionId: string) => void | Promise<void>;
  onNewSession: () => void | Promise<void>;
};

export function WorkbenchComposerColumn(props: WorkbenchComposerColumnProps): ReactElement {
  const {
    state,
    activeSessionName,
    composerCard,
    onTrustProject,
    onUnarchiveSession,
    onNewSession,
  } = props;
  return (
    <>
      {state.projectPath && !state.projectTrusted ? (
        <div className="composer-sticky-banner chat-inline-notice">
          <ProjectTrustNotice
            projectPath={state.projectPath}
            onTrust={() => void onTrustProject(true)}
          />
        </div>
      ) : null}
      {state.activeSessionArchived ? (
        <div className="composer-sticky-banner chat-inline-notice">
          <SessionArchivedBanner
            sessionName={activeSessionName}
            onRestore={() => {
              if (state.activeSessionId) {
                void onUnarchiveSession(state.activeSessionId);
              }
            }}
            onNewAgent={() => void onNewSession()}
          />
        </div>
      ) : null}
      <ComposerDock {...composerCard} goalMessages={state.messages} />
    </>
  );
}
