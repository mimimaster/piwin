/**
 * Conversation column of the desktop workbench (extracted from App.tsx).
 * Host commands stay with App; this file owns transcript, permission, and
 * composer-dock chrome.
 */
import type { Dispatch, ReactElement } from 'react';
import type {
  ContextSummaryPush,
  FlashcardReviewCard,
  ModelRef,
  PermissionDecision,
  PermissionRememberScope,
  PiwinConfig,
  PlanExecutionMode,
  ProductSessionLineageView,
  SessionPlan,
  ThemeManifest,
  TranscriptBranchPoint,
} from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import { Button, Notice } from '@piwin/ui-kit';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import { ChatThread } from './chat-thread';
import type {
  ChatMessageUi,
  ChatUiAction,
  ChatUiState,
} from './chat-reducer';
import { ComposerDock, type ComposerDockProps } from './composer-dock';
import type { DesktopLocale } from './desktop-locale';
import { ExtensionUiPrompt, type ExtensionUiResolvePayload } from './extension-ui-prompt';
import type { HostClient } from './host-client';
import { HostReconnectBanner } from './host-reconnect-banner';
import { shouldShowHostReconnectBanner } from './host-reconnect-gate.js';
import { InkWashEmptyVignette } from './ink-wash-empty-vignette';
import type { KnowledgeCenterPanelProps } from './KnowledgeCenterPanel';
import type { ModelOption } from './model-options';
import { PermissionBar } from './permission-bar';
import { ProjectTrustNotice } from './project-trust-notice';
import { SessionArchivedBanner } from './session-archived-banner';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { DocumentOpenInput } from './tool-call-card';
import { TranscriptViewport } from './transcript-viewport';
import type { DesktopPreferences } from './ui-preferences';
import type { ExtensionUiRequestState } from './hooks/use-host-bootstrap';

export type WorkbenchTranscriptProps = {
  locale: DesktopLocale;
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  visibleMessages: ChatMessageUi[];
  visibleRunRecordsById: ChatUiState['runRecordsById'];
  historyViewActive: boolean;
  activitySignal: string;
  transcriptHistoryLoading: boolean;
  lastUserMessageId: string | null;
  composerCard: ComposerDockProps;
  config: PiwinConfig | null;
  preferences: DesktopPreferences;
  sessionPlan: SessionPlan | null | undefined;
  currentPromptModel: ModelRef | null;
  modelOptions: ModelOption[];
  requestKnowledgeCenter: KnowledgeCenterPanelProps['request'];
  resolveFlashcards: (itemIds: string[]) => Promise<FlashcardReviewCard[]>;
  requestGit: HostClient['request'];
  editingMessageId: string | null;
  activeTheme: ThemeManifest;
  artifactThemeKey: string;
  assemblySummariesByRunId: Record<string, ContextSummaryPush>;
  sessionLineage: ProductSessionLineageView | null | undefined;
  forkCountsByMessageId: Record<string, number>;
  branchPoints: TranscriptBranchPoint[];
  onJumpToHistoryAnchor: NonNullable<
    import('./transcript-viewport').TranscriptViewportProps['onJumpToHistoryAnchor']
  >;
  onReturnToLatest: () => void;
  onLoadOlder: () => Promise<void>;
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
  onBranchResend: (messageId: string, text: string) => void;
  onSwitchBranch: (headMessageId: string) => void;
  onInterventionEdit: (messageId: string, text: string) => void | Promise<void>;
  onInterventionCancel: (messageId: string) => void | Promise<void>;
  onFeedback: (message: string, level: 'info' | 'success' | 'error') => void;
  onArtifactAction: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas: (target: ArtifactCanvasTarget) => void;
  onOpenDocument: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  onOpenDiff: (absolutePath: string, relativePath?: string) => void;
  onPlanExecute: (mode: PlanExecutionMode) => void | Promise<void>;
  onPlanAbort: () => void | Promise<void>;
  onGenerateWalkthrough: (messageId: string, force?: boolean) => void | Promise<void>;
  onCancelWalkthrough: (messageId: string, generationId?: string) => void | Promise<void>;
  onDuplicateSession: (sessionId: string) => void | Promise<void>;
  onForkFromMessage: (sessionId: string, messageId: string) => void | Promise<void>;
  onOpenSession: (sessionId: string) => void | Promise<void>;
  onCompactAbort: () => void | Promise<void>;
};

export function WorkbenchTranscript(props: WorkbenchTranscriptProps): ReactElement {
  const {
    locale,
    hostClient,
    state,
    dispatch,
    visibleMessages,
    visibleRunRecordsById,
    historyViewActive,
    activitySignal,
    transcriptHistoryLoading,
    lastUserMessageId,
    composerCard,
    config,
    preferences,
    sessionPlan,
    currentPromptModel,
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
    onOpenReview,
    onPermission,
    onInspectSubagent,
    onEdit,
    onCancelEdit,
    onEditResend,
    onRetry,
    onBranchResend,
    onSwitchBranch,
    onInterventionEdit,
    onInterventionCancel,
    onFeedback,
    onArtifactAction,
    onOpenArtifactCanvas,
    onOpenDocument,
    onOpenDiff,
    onPlanExecute,
    onPlanAbort,
    onGenerateWalkthrough,
    onCancelWalkthrough,
    onDuplicateSession,
    onForkFromMessage,
    onOpenSession,
    onCompactAbort,
  } = props;
  const activeSessionId = state.activeSessionId;

  return (
    <>
      {shouldShowHostReconnectBanner({
        transport: hostClient.getTransport(),
        wireReady: hostClient.isReady(),
      }) ? (
        <HostReconnectBanner locale={locale} />
      ) : null}
      {state.awaitingTranscript ? (
        <div
          className="transcript-awaiting-banner"
          data-testid="transcript-awaiting-banner"
          role="status"
          aria-live="polite"
        >
          {locale === 'zh-CN' ? '正在加载会话…' : 'Loading session…'}
        </div>
      ) : null}
      <TranscriptViewport
        key={activeSessionId ?? 'no-session'}
        messageCount={visibleMessages.length}
        activitySignal={historyViewActive ? 'history-view' : activitySignal}
        messages={visibleMessages}
        historyIndex={state.userMessageIndex}
        onJumpToHistoryAnchor={onJumpToHistoryAnchor}
        historyViewActive={historyViewActive}
        onReturnToLatest={onReturnToLatest}
        canLoadOlder={
          !historyViewActive &&
          state.transcriptWindow?.olderCursor !== undefined &&
          state.transcriptWindow.cacheLimitReached !== true
        }
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
          <ChatThread
            messages={visibleMessages}
            {...(activeSessionId ? { sessionId: activeSessionId } : {})}
            streaming={!historyViewActive && state.streaming}
            activeSessionId={activeSessionId}
            docCardRequest={requestKnowledgeCenter as never}
            isConversationSession={state.activeScope.kind === 'general'}
            onResolveFlashcards={resolveFlashcards}
            livePromptModel={currentPromptModel}
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
            projectPath={state.projectPath}
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
            artifactPreviewEnabled={config?.artifact?.enabled ?? true}
            artifactCodeFirst={preferences.artifactCodeFirst}
            plan={sessionPlan ?? null}
            {...(config?.artifact?.maxBytes !== undefined
              ? { artifactMaxBytes: config.artifact.maxBytes }
              : {})}
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
            onBranchResend={onBranchResend}
            branchPoints={branchPoints}
            onSwitchBranch={onSwitchBranch}
            onInterventionEdit={onInterventionEdit}
            onInterventionCancel={onInterventionCancel}
            onFeedback={onFeedback}
            onArtifactAction={onArtifactAction}
            onOpenArtifactCanvas={onOpenArtifactCanvas}
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
                  onOpenDocument,
                }
              : {})}
            onOpenDiff={onOpenDiff}
            onPlanExecute={onPlanExecute}
            onPlanAbort={onPlanAbort}
            composerCard={composerCard}
            walkthroughsByMessageId={state.walkthroughsByMessageId}
            walkthroughEnabled={config?.walkthrough?.enabled !== false}
            walkthroughAutoGenerate={false}
            onGenerateWalkthrough={onGenerateWalkthrough}
            onCancelWalkthrough={onCancelWalkthrough}
            {...(activeSessionId
              ? {
                  onDuplicateSession: () => void onDuplicateSession(activeSessionId),
                  onForkFromMessage: (messageId: string) =>
                    void onForkFromMessage(activeSessionId, messageId),
                }
              : {})}
            {...(sessionLineage ? { sessionLineage } : {})}
            forkCountsByMessageId={forkCountsByMessageId}
            onOpenSession={(sessionId: string) => void onOpenSession(sessionId)}
            derivedActionsDisabled={!activeSessionId || state.streaming || state.awaitingTranscript}
          />
        ) : null}
      </TranscriptViewport>
      {state.compacting ? (
        <Notice
          tone="info"
          testId="compaction-progress-notice"
          title="Compacting context…"
          action={
            <Button size="compact" onClick={() => void onCompactAbort()}>
              Cancel
            </Button>
          }
        />
      ) : null}
      {!state.compacting && state.lastCompactionMessage ? (
        <Notice
          tone="success"
          testId="compaction-result-notice"
          title={state.lastCompactionMessage}
          action={
            <Button
              size="compact"
              onClick={() => dispatch({ type: 'compaction/dismiss' })}
            >
              Dismiss
            </Button>
          }
          details={
            <>
              {typeof state.lastCompactionDurationMs === 'number' ? (
                <span className="muted">Duration {state.lastCompactionDurationMs}ms</span>
              ) : null}
              {typeof state.lastCompactionTokensBefore === 'number' ||
              typeof state.lastCompactionTokensAfter === 'number' ? (
                <div className="muted banner-meta">
                  Tokens
                  {typeof state.lastCompactionTokensBefore === 'number'
                    ? ` before: ${state.lastCompactionTokensBefore}`
                    : ''}
                  {typeof state.lastCompactionTokensAfter === 'number'
                    ? ` → after: ${state.lastCompactionTokensAfter}`
                    : ''}
                </div>
              ) : null}
              {state.lastCompactionSummary ? (
                <details className="banner-details">
                  <summary>Summary</summary>
                  <pre className="banner-summary-pre">
                    {state.lastCompactionSummary.slice(0, 500)}
                  </pre>
                </details>
              ) : null}
            </>
          }
        />
      ) : null}
    </>
  );
}

export type WorkbenchPermissionBarProps = {
  state: ChatUiState;
  extensionUiRequest: ExtensionUiRequestState | null;
  onPermission: (
    decision: PermissionDecision,
    scope?: PermissionRememberScope,
  ) => void | Promise<void>;
  onExtensionUiResolve: (payload: ExtensionUiResolvePayload) => void | Promise<void>;
};

export function WorkbenchPermissionBar(
  props: WorkbenchPermissionBarProps,
): ReactElement | null {
  const { state, extensionUiRequest, onPermission, onExtensionUiResolve } = props;
  if (state.activeScope.kind !== 'general' && state.permissionPrompt) {
    return (
      <PermissionBar
        prompt={state.permissionPrompt}
        projectPath={state.projectPath}
        onPermission={(decision, scope) => {
          void onPermission(decision, scope);
        }}
      />
    );
  }
  if (state.activeScope.kind !== 'general' && extensionUiRequest) {
    return (
      <ExtensionUiPrompt
        request={extensionUiRequest}
        onResolve={(payload) => void onExtensionUiResolve(payload)}
      />
    );
  }
  return null;
}

export type WorkbenchComposerColumnProps = {
  state: ChatUiState;
  activeTheme: ThemeManifest;
  activeSessionName: string;
  composerCard: ComposerDockProps;
  onTrustProject: (trust: boolean) => void | Promise<void>;
  onUnarchiveSession: (sessionId: string) => void | Promise<void>;
  onNewSession: () => void | Promise<void>;
};

export function WorkbenchComposerColumn(props: WorkbenchComposerColumnProps): ReactElement {
  const {
    state,
    activeTheme,
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
      {state.messages.length === 0 && !state.awaitingTranscript ? (
        <InkWashEmptyVignette theme={activeTheme} />
      ) : null}
      <ComposerDock {...composerCard} />
    </>
  );
}
