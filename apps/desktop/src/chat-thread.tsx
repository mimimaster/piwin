/**
 * Scrollable assistant/user message list with edit/retry actions.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { RadialBellow } from '@piwin/ui-kit';
import type {
  ContextSummaryPush,
  ContextUsageSnapshot,
  ModelProviderConfig,
  ModelRef,
  PermissionDecision,
  PermissionRememberScope,
  ProductSessionLineageView,
  SessionPlan,
  SessionSummary,
  TranscriptBranchPoint,
  SubagentInvocation,
  ThemeManifest,
  WalkthroughArtifact,
} from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import type {
  ChatMessageUi,
  PermissionPromptUi,
  RunRecordUi,
  SkillActivityView,
  CompactionActivityUi,
  SubagentStreamState,
} from './chat-reducer';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { DocumentOpenInput } from './tool-call-card';
import { RunActivitySlot } from './RunActivitySlot.js';
import { isAssistantContentEmpty } from './assistant-message-content.js';
import { PlanCard } from './plan-card';
import { GoalStickyStrip } from './goal';
import { resolveAssemblySummaryForUserMessage } from './assembly-summary-capsule';
import { isWalkthroughEligible } from './walkthrough-action';
import type { FilesChangedBarRequest } from './files-changed-bar';
import {
  conversationActivityLabel,
  resolveConversationActivityKind,
} from './conversation-activity.js';
import type { AgentLocatorAnimation, ToolCallDensity, WorkDetailsExpanded } from './ui-preferences';
import type { ComposerDockProps } from './composer-dock';
import type { DiffCardRequest } from './diff-card';
import type { ModelOption } from './model-options';
import { TranscriptTurnList } from './transcript-turn-list';
import { groupTranscriptTurns } from './transcript-turns';
import { buildExploreFlowRoles } from './explore-flow';
import { collectMessageChangedFiles } from './collect-message-changed-files';
import { findStreamingCaretMessageId } from './streaming-caret';
import { DocCardSequenceView, type DocCardSequenceRequest } from './DocCardSequenceView';
import { ChatMessageRow } from './chat-message-row';
import { collectFlashcardToolsFromMessages } from './conversation-response-content.js';
import {
  buildConversationTurnUsageChip,
  ConversationTurnIdentityHeader,
} from './conversation-message-header';
import { resolveConversationTurnChrome } from './conversation-turn-chrome';
import { projectTurnWorkDisclosure } from './turn-work-disclosure-model.js';
import { TurnWorkDisclosure } from './turn-work-disclosure.js';
import { TurnWorkDetails } from './turn-work-details.js';
import { CompactionActivity } from './compaction-activity.js';

/** Legacy helper retained for callers that still compute the old preference. */
/** @deprecated Run Inspector disclosure is now explicitly user-owned. */
export function shouldCollapseTurnToolHistory(input: {
  workDetailsMessage: ChatMessageUi;
  activeRunId: string | null;
  answerText: string;
}): boolean {
  void input.answerText;
  const runId = input.workDetailsMessage.runId;
  const runActive =
    input.workDetailsMessage.status === 'streaming' ||
    (runId !== undefined && input.activeRunId !== null && runId === input.activeRunId);
  return !runActive;
}

/** Render-only copy used to place the final answer's reasoning in Work. */
function createThinkingOnlyMessage(message: ChatMessageUi): ChatMessageUi {
  const thinkingMessage = { ...message };
  delete thinkingMessage.searchEvidence;
  delete thinkingMessage.subagentActivity;
  return {
    ...thinkingMessage,
    id: `${message.id}:thinking`,
    text: '',
    tools: [],
    attachments: [],
  };
}

export type ChatThreadProps = {
  messages: ChatMessageUi[];
  /** Active product session owning the rendered transcript. */
  sessionId?: string;
  streaming: boolean;
  editingMessageId: string | null;
  lastUserMessageId: string | null;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: string | number;
  /** Active session id — CM-10 message context menu source session. */
  activeSessionId?: string | null;

  /** Session-level plan rendered once at the top of the thread (not per-message). */
  plan?: SessionPlan | null;
  runRecordsById?: Record<string, RunRecordUi>;
  activeRunId?: string | null;
  /** Explicit slash Skill currently associated with the foreground prompt. */
  activeSkill?: SkillActivityView | null;
  /** Animation used by the compact live agent locator. */
  agentLocatorAnimation?: AgentLocatorAnimation;
  permissionPrompt?: PermissionPromptUi | null;
  /** Project path used to gate "always allow" (project remember) availability. */
  projectPath?: string | null;
  /** Host git request adapter forwarded to tool cards → DiffCard. */
  toolDiffRequest?: DiffCardRequest;
  /**
   * Host git request for turn-level files-changed stats (`git/diff-summary`).
   * Same adapter as ChangesPanel; optional so the bar still lists paths without stats.
   */
  filesChangedRequest?: FilesChangedBarRequest;
  onReviewChanges?: () => void;
  onPermission?: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
  workDetailsExpanded?: WorkDetailsExpanded;
  toolDensity?: ToolCallDensity;
  /** Whether intermediate Agent thinking should be rendered in the timeline. */
  showThinking?: boolean;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  /** Resend a user turn as a sibling branch (changed-text edit). */
  onBranchResend?: (messageId: string, text: string) => void;
  /** Re-run the same user turn without creating a prompt sibling. */
  onRetryTurn?: (userMessageId: string, options: { keepPrevious: boolean }) => void;
  branchPoints?: TranscriptBranchPoint[];
  onSwitchBranch?: (headMessageId: string) => void;
  /** Edit a still-pending instruction without rewinding conversation history. */
  onInterventionEdit?: (messageId: string, text: string) => void | Promise<void>;
  /** Cancel a still-pending instruction without cancelling its target Run. */
  onInterventionCancel?: (messageId: string) => void | Promise<void>;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
  /** Open the read-only subagent session inspector for a transcript card. */
  onInspectSubagent: ((selection: SubagentInspectorSelection) => void) | undefined;
  /** Load / rate / open-source for Doc Cards sequence messages. */
  docCardRequest?: DocCardSequenceRequest;
  /** Child projections bound to delegation tool calls in the transcript. */
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  /** Live child tails used for each inline block's latest activity. */
  subagentStreams?: Record<string, SubagentStreamState>;
  /** Whitelisted artifact actions, e.g. flashcard rating (ADR 0018 S5c). */
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  /** Open a fence explicitly declared with surface="canvas". */
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  /**
   * Artifact capability from `config.artifact.enabled`. Required boolean —
   * never a truthy spread that drops `false`.
   */
  artifactPreviewEnabled: boolean;
  /** When true, MarkdownView displays source code first for artifact blocks. */
  artifactCodeFirst?: boolean;
  /** Security byte cap forwarded to analyzeArtifactFence. */
  artifactMaxBytes?: number;
  /** Global composer configuration so the in-place edit card matches the bottom dock. */
  composerCard: ComposerDockProps;
  /** Callback when clicking a search result file or file link. */
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Open an edited file's diff in the right inspector. */
  onOpenDiff?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Callback when clicking a markdown document link or plan document chip. */
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  /** Called when the user aborts a running plan. */
  onPlanAbort?: (() => void | Promise<void>) | undefined;
  /** Transcript-bound compaction lifecycle activity. */
  compactionActivity?: CompactionActivityUi | null | undefined;
  onCompactAbort?: (() => void | Promise<void>) | undefined;
  onCompactDismiss?: (() => void) | undefined;
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
  /** Walkthrough artifacts keyed by owning assistant messageId (spec §5.1). */
  walkthroughsByMessageId?: Record<string, WalkthroughArtifact>;
  /** Whether the Generate Walkthrough action is enabled (config walkthrough.enabled). */
  walkthroughEnabled?: boolean;
  /** Whether auto-generation is active (config walkthrough.autoGenerate). */
  walkthroughAutoGenerate?: boolean;
  /** Generate a walkthrough for a message; force overwrites an existing artifact. */
  onGenerateWalkthrough?:
    ((messageId: string, force?: boolean) => void | Promise<void>) | undefined;
  /** Cancel an in-flight walkthrough generation. */
  onCancelWalkthrough?:
    ((messageId: string, generationId?: string) => void | Promise<void>) | undefined;
  /** SF-03: Duplicate the entire session. */
  /** SF-03: Fork from a specific assistant response. */
  onForkFromMessage?: ((messageId: string) => void | Promise<void>) | undefined;
  /** SF-03: Open the lineage / branch list for a message. */
  onOpenForks?: ((messageId: string) => void) | undefined;
  /** SF-03: Map of messageId → direct fork count (for badge display). */
  forkCountsByMessageId?: Record<string, number>;
  /** SF-04: Product lineage projection for the active session. */
  sessionLineage?: ProductSessionLineageView | null;
  /** SF-04: Navigate to another product session from the lineage tree. */
  onOpenSession?: ((sessionId: string) => void) | undefined;
  /** SF-03: Whether derived-session actions are disabled (e.g. no host). */
  derivedActionsDisabled?: boolean;
  /** M1 assembly summaries keyed by runId. Never claims model-visible. */
  assemblySummariesByRunId?: Record<string, ContextSummaryPush>;
  /**
   * CHT-401: general-scope main session. Default false so Project callers and
   * existing tests keep the Agent presentation.
   */
  isConversationSession?: boolean;
  onResolveFlashcards?: (
    itemIds: string[],
  ) => Promise<import('@piwin/contracts').FlashcardReviewCard[]>;
  /** Frozen send-time model for the in-flight turn's pending assistant row. */
  livePromptModel?: ModelRef | null;
  /** Active model options for name resolution. */
  modelOptions?: readonly ModelOption[];
  /** Configured providers for display names. */
  configProviders?: readonly ModelProviderConfig[];
  /** Session last turn context usage snapshot for turn usage chip. */
  contextUsage?: ContextUsageSnapshot | null;
};

export function ChatThread(props: ChatThreadProps): ReactElement {
  // Quiet workbench: msg-in only for messages that arrive after first mount
  // (history hydrate must not replay entrance animation).
  const knownIdsRef = useRef<Set<string> | null>(null);
  const isInitialMountRef = useRef(true);
  if (knownIdsRef.current === null) {
    knownIdsRef.current = new Set(props.messages.map((message) => message.id));
  }
  const enteringIds = new Set<string>();
  if (!isInitialMountRef.current) {
    for (const message of props.messages) {
      if (!knownIdsRef.current.has(message.id)) {
        enteringIds.add(message.id);
      }
    }
  }
  useEffect(() => {
    isInitialMountRef.current = false;
    const known = knownIdsRef.current ?? new Set<string>();
    for (const message of props.messages) {
      known.add(message.id);
    }
    knownIdsRef.current = known;
  }, [props.messages]);

  // A pending/starting queued turn already has a dedicated Host-owned queue
  // row above the composer. Keep its durable transcript row in state for
  // reload/reconciliation, but do not render the same text as a second chat
  // bubble until the Host has actually started the turn.
  const transcriptMessages = useMemo(
    () =>
      props.messages.filter((message) => {
        const delivery = message.instructionDelivery;
        return !(
          delivery?.kind === 'queued-turn' &&
          (delivery.status === 'pending' || delivery.status === 'starting')
        );
      }),
    [props.messages],
  );
  const effectiveMessages = useMemo(() => {
    if (!props.isConversationSession || !props.streaming) {
      return transcriptMessages;
    }
    const tail = transcriptMessages[transcriptMessages.length - 1];
    if (tail?.role === 'user') {
      const pendingAssistantMessage: ChatMessageUi = {
        id: `pending-assistant-${tail.id}`,
        role: 'assistant',
        text: '',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'streaming',
        createdAt: new Date().toISOString(),
        ...(props.livePromptModel ? { model: props.livePromptModel } : {}),
      };
      return [...transcriptMessages, pendingAssistantMessage];
    }
    return transcriptMessages;
  }, [props.isConversationSession, props.streaming, props.livePromptModel, transcriptMessages]);
  const docCardSequence = useMemo(
    () => effectiveMessages.find((message) => message.docCardSequence)?.docCardSequence,
    [effectiveMessages],
  );
  const chatMessages = useMemo(
    () =>
      docCardSequence
        ? effectiveMessages.filter((message) => !message.docCardSequence)
        : effectiveMessages,
    [docCardSequence, effectiveMessages],
  );

  const activeToolName = useMemo(() => {
    for (let i = transcriptMessages.length - 1; i >= 0; i--) {
      const msg = transcriptMessages[i];
      if (msg?.role === 'assistant') {
        const runningTool = msg.tools.find((t) => t.status === 'running');
        if (runningTool) return runningTool.toolName;
      }
    }
    return undefined;
  }, [transcriptMessages]);

  const turnGroups = useMemo(() => groupTranscriptTurns(chatMessages), [chatMessages]);
  const [workDisclosureOpenByTurnId, setWorkDisclosureOpenByTurnId] = useState<
    Record<string, boolean>
  >({});
  // Cursor-style explore flow: consecutive read/search/thought-only assistant
  // steps collapse into one "Explored N files" capsule anchored at the first
  // step (agent sessions only — conversation mode keeps per-reply chrome).
  const exploreRolesByMessageId = useMemo(
    () =>
      props.isConversationSession === true
        ? new Map()
        : buildExploreFlowRoles(chatMessages, { streamActive: props.streaming === true }),
    [chatMessages, props.isConversationSession, props.streaming],
  );
  const precedingUser = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const msg = chatMessages[i];
      if (msg?.role === 'user') {
        return msg;
      }
    }
    return undefined;
  }, [chatMessages]);
  const currentResponseTurnId = turnGroups[turnGroups.length - 1]?.id ?? null;
  const compactionActivityTurnId = useMemo(() => {
    const activity = props.compactionActivity;
    if (!activity) {
      return null;
    }
    if (activity.anchorMessageId) {
      const anchoredTurn = turnGroups.find((turn) =>
        turn.items.some((item) => item.message.id === activity.anchorMessageId),
      );
      if (anchoredTurn) {
        return anchoredTurn.id;
      }
    }
    return currentResponseTurnId;
  }, [currentResponseTurnId, props.compactionActivity, turnGroups]);
  const transcriptTail = transcriptMessages[transcriptMessages.length - 1];
  // Providers open the assistant lifecycle before the first token, and a model
  // that reasons without streaming its reasoning keeps that bubble empty for
  // the whole think. Without this the locator would hand off to nothing and the
  // turn would look frozen behind a bare model header.
  const tailAwaitsFirstOutput =
    transcriptTail !== undefined &&
    transcriptTail.status === 'streaming' &&
    isAssistantContentEmpty(transcriptTail);
  const conversationSession = props.isConversationSession === true;
  const effectiveTail = chatMessages[chatMessages.length - 1];
  const effectiveTailAwaitsFirstOutput =
    effectiveTail !== undefined &&
    effectiveTail.status === 'streaming' &&
    isAssistantContentEmpty(effectiveTail);
  const showRunActivity =
    props.streaming &&
    props.activeRunId != null &&
    !props.permissionPrompt &&
    (conversationSession
      ? chatMessages.length === 0 ||
        (effectiveTail?.role === 'user' && !effectiveTailAwaitsFirstOutput)
      : transcriptMessages.length === 0 ||
        transcriptTail?.role === 'user' ||
        tailAwaitsFirstOutput);
  const conversationActivityKind = conversationSession
    ? resolveConversationActivityKind({
        streaming: props.streaming,
        tools: transcriptMessages.flatMap((message) => message.tools),
      })
    : null;
  const runActivitySlot = showRunActivity ? (
    conversationSession ? (
      conversationActivityKind ? (
        <div className="chat-run-activity-line" data-testid="conversation-activity">
          <div className="agent-locator-stack">
            <div
              className="agent-locator"
              role="status"
              aria-live="polite"
              data-testid="conversation-agent-locator"
              data-activity-id={conversationActivityKind}
            >
              <span className="agent-locator-visual" aria-hidden="true">
                <RadialBellow
                  size="sm"
                  label={conversationActivityLabel(
                    conversationActivityKind,
                    props.locale ?? 'zh-CN',
                  )}
                  testId="conversation-locator-radial-bellow"
                />
              </span>
              <span
                className="agent-locator-copy agent-locator-copy--shimmer"
                data-testid="conversation-activity-copy"
              >
                {conversationActivityLabel(conversationActivityKind, props.locale ?? 'zh-CN')}
              </span>
            </div>
          </div>
        </div>
      ) : null
    ) : (
      <RunActivitySlot
        activeRunId={props.activeRunId ?? null}
        runRecordsById={props.runRecordsById ?? {}}
        {...(activeToolName ? { activeToolName } : {})}
        {...(props.locale ? { locale: props.locale } : {})}
        {...(props.agentLocatorAnimation ? { animation: props.agentLocatorAnimation } : {})}
        {...(props.activeSkill ? { skill: props.activeSkill } : {})}
      />
    )
  ) : null;
  const changedFilePathsByTurnId = useMemo(() => {
    const pathsByTurnId = new Map<string, string[]>();
    for (const turn of turnGroups) {
      const paths = new Set<string>();
      for (const item of turn.items) {
        for (const file of collectMessageChangedFiles(item.message.tools ?? [])) {
          paths.add(file.path);
        }
      }
      pathsByTurnId.set(turn.id, Array.from(paths));
    }
    return pathsByTurnId;
  }, [turnGroups]);

  // Find the single assistant message that should show the streaming caret.
  const streamingCaretMessageId = useMemo(() => {
    if (!props.streaming) return null;
    return findStreamingCaretMessageId(
      chatMessages,
      props.runRecordsById ?? {},
      props.activeRunId ?? null,
    );
  }, [chatMessages, props.activeRunId, props.runRecordsById, props.streaming]);

  // SF-04: The newest completed assistant response gets the lineage tree in its action row.
  const latestAssistantMessageId = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const msg = chatMessages[i];
      if (msg && msg.role === 'assistant') {
        return msg.id;
      }
    }
    return null;
  }, [chatMessages]);

  return (
    <div
      className={`chat-thread${conversationSession ? ' is-conversation' : ''}`}
      data-testid="chat-thread"
    >
      {docCardSequence && props.docCardRequest ? (
        <div className="chat-doc-card-sequence-slot">
          <DocCardSequenceView sequence={docCardSequence} request={props.docCardRequest} />
        </div>
      ) : null}
      {props.plan && !conversationSession ? (
        <PlanCard
          plan={props.plan}
          {...(props.onOpenDocument
            ? {
                onOpenDocument: (doc) =>
                  props.onOpenDocument?.({
                    title: doc.title,
                    path: doc.title,
                    ...(doc.content !== undefined ? { content: doc.content } : {}),
                  }),
              }
            : {})}
          {...(props.onPlanAbort ? { onAbort: props.onPlanAbort } : {})}
        />
      ) : null}
      {props.composerCard.agentMode === 'goal' && props.messages.length > 0 ? (
        <GoalStickyStrip
          goalTitle={
            [...props.messages].reverse().find((m) => m.role === 'user')?.text ||
            (props.locale === 'zh-CN' ? '目标自主执行循环' : 'Autonomous Goal Execution')
          }
          status={props.streaming ? 'running' : 'paused'}
          turnsCount={props.messages.filter((m) => m.role === 'user').length}
          onAbort={() => {
            props.composerCard.onAbort();
            props.composerCard.onAgentModeChange('agent');
          }}
        />
      ) : null}
      <TranscriptTurnList
        turns={turnGroups}
        pinnedMessageId={props.editingMessageId}
        streaming={props.streaming === true}
        renderTurn={(turn) => {
          const turnMessages = turn.items.map((item) => item.message);
          const currentTurnStreaming =
            turn.id === currentResponseTurnId && props.streaming === true;
          const turnModel =
            turnMessages.find((item) => item.model)?.model ??
            (conversationSession && currentTurnStreaming
              ? (props.livePromptModel ?? undefined)
              : undefined);
          const turnFlashcardTools = collectFlashcardToolsFromMessages(turnMessages);
          const conversationChrome = conversationSession
            ? resolveConversationTurnChrome({
                messages: turnMessages,
                lastAssistantMessageId: turn.lastAssistantMessageId,
                latestAssistantMessageId,
              })
            : null;
          const workDisclosureProjection = projectTurnWorkDisclosure({
            turn,
            runRecordsById: props.runRecordsById ?? {},
            activeRunId: props.activeRunId ?? null,
            currentTurnStreaming,
          });
          const workDisclosureKey = `${props.sessionId ?? 'session'}:${turn.id}`;
          const workDisclosureDefaultOpen = props.workDetailsExpanded === 'always';
          const workDisclosureOpen =
            workDisclosureOpenByTurnId[workDisclosureKey] ?? workDisclosureDefaultOpen;
          const identityItemIndex = conversationChrome?.identityMessageId
            ? turn.items.findIndex(
                (item) => item.message.id === conversationChrome.identityMessageId,
              )
            : -1;
          const identityHiddenByCollapsedDisclosure =
            identityItemIndex >= 0 &&
            workDisclosureProjection !== null &&
            !workDisclosureOpen &&
            identityItemIndex >= workDisclosureProjection.startIndex &&
            identityItemIndex <= workDisclosureProjection.endIndex;
          const identitySource =
            identityItemIndex >= 0 ? turn.items[identityItemIndex]?.message : undefined;
          const identityForHeader =
            identitySource === undefined
              ? undefined
              : !identitySource.model && turnModel
                ? { ...identitySource, model: turnModel }
                : identitySource;
          return (
            <section
              key={turn.id}
              className={`chat-turn-group${turn.id === currentResponseTurnId ? ' is-current-response' : ''}`}
              {...(turn.id === currentResponseTurnId
                ? { 'data-testid': 'current-response-turn' }
                : {})}
            >
              {turn.items.flatMap(({ message, messageIndex }, itemIndex) => {
                const isDisclosureWorkItem =
                  workDisclosureProjection !== null &&
                  itemIndex >= workDisclosureProjection.startIndex &&
                  itemIndex <= workDisclosureProjection.endIndex;
                const isDisclosureStart = workDisclosureProjection?.startIndex === itemIndex;
                const disclosureTrigger =
                  isDisclosureStart && workDisclosureProjection ? (
                    <TurnWorkDisclosure
                      key={`work-disclosure-${turn.id}`}
                      projection={workDisclosureProjection}
                      open={workDisclosureOpen}
                      locale={props.locale ?? 'zh-CN'}
                      onToggle={() =>
                        setWorkDisclosureOpenByTurnId((current) => ({
                          ...current,
                          [workDisclosureKey]: !(
                            current[workDisclosureKey] ?? workDisclosureDefaultOpen
                          ),
                        }))
                      }
                    />
                  ) : null;
                const foldedIdentityHeader =
                  identityHiddenByCollapsedDisclosure &&
                  identityForHeader &&
                  isDisclosureStart ? (
                    <ConversationTurnIdentityHeader
                      key={`turn-identity-${turn.id}`}
                      message={identityForHeader}
                      turnStreaming={currentTurnStreaming}
                      locale={props.locale ?? 'zh-CN'}
                      {...(props.livePromptModel !== undefined
                        ? { livePromptModel: props.livePromptModel }
                        : {})}
                      {...(props.modelOptions !== undefined
                        ? { modelOptions: props.modelOptions }
                        : {})}
                      {...(props.configProviders !== undefined
                        ? { configProviders: props.configProviders }
                        : {})}
                      usageChip={
                        conversationChrome?.showUsageOnIdentity === true
                          ? buildConversationTurnUsageChip(
                              props.contextUsage,
                              props.locale ?? 'zh-CN',
                            )
                          : null
                      }
                    />
                  ) : null;
                if (isDisclosureWorkItem && !workDisclosureOpen) {
                  return [foldedIdentityHeader, disclosureTrigger].filter(
                    (node): node is ReactElement => node !== null,
                  );
                }
                const followingAssistantRunId = turn.items
                  .slice(itemIndex + 1)
                  .find((item) => item.message.role === 'assistant' && item.message.runId)
                  ?.message.runId;
                const assemblySummary =
                  message.role === 'user'
                    ? resolveAssemblySummaryForUserMessage({
                        messageId: message.id,
                        ...(message.runId !== undefined
                          ? { messageRunId: message.runId }
                          : {}),
                        lastUserMessageId: props.lastUserMessageId,
                        activeRunId: props.activeRunId ?? null,
                        ...(followingAssistantRunId !== undefined
                          ? { followingAssistantRunId }
                          : {}),
                        summariesByRunId: props.assemblySummariesByRunId ?? {},
                      })
                    : undefined;
                const isLatestTurn =
                  turn.lastAssistantMessageId !== null &&
                  turn.lastAssistantMessageId === latestAssistantMessageId;
                const isConversationIdentityMessage =
                  conversationChrome?.identityMessageId === message.id;
                const isLatestAssistant =
                  latestAssistantMessageId === message.id ||
                  (conversationSession && isConversationIdentityMessage && isLatestTurn);
                const onRegenerate =
                  conversationSession &&
                  isLatestAssistant &&
                  precedingUser &&
                  props.onRetryTurn
                    ? () => props.onRetryTurn?.(precedingUser.id, { keepPrevious: true })
                    : undefined;
                const exploreRole = exploreRolesByMessageId.get(message.id);
                const moveFinalThinkingIntoWork =
                  !conversationSession &&
                  workDisclosureProjection !== null &&
                  itemIndex === workDisclosureProjection.endIndex + 1 &&
                  message.role === 'assistant' &&
                  message.thinking.trim().length > 0 &&
                  props.showThinking !== false &&
                  exploreRole === undefined;
                const effectiveMessage =
                  conversationSession &&
                  message.role === 'assistant' &&
                  !message.model &&
                  turnModel
                    ? { ...message, model: turnModel }
                    : message;
                const row = (
                  <ChatMessageRow
                    key={message.id}
                    message={effectiveMessage}
                    {...(exploreRole !== undefined ? { exploreRole } : {})}
                    isConversationSession={conversationSession}
                    {...(conversationChrome
                      ? {
                          showConversationHeader:
                            conversationChrome.identityMessageId === message.id &&
                            !identityHiddenByCollapsedDisclosure,
                          showConversationTurnUsage:
                            conversationChrome.showUsageOnIdentity &&
                            !identityHiddenByCollapsedDisclosure,
                        }
                      : {})}
                    {...(props.onResolveFlashcards
                      ? { onResolveFlashcards: props.onResolveFlashcards }
                      : {})}
                    {...(assemblySummary !== undefined ? { assemblySummary } : {})}
                    {...(props.sessionId ? { sessionId: props.sessionId } : {})}
                    messageIndex={messageIndex}
                    showStreamingCaret={streamingCaretMessageId === message.id}
                    isLastAssistantInTurn={turn.lastAssistantMessageId === message.id}
                    {...(turnFlashcardTools.length > 0 ? { turnFlashcardTools } : {})}
                    isLatestAssistantResponse={isLatestAssistant}
                    {...(props.livePromptModel !== undefined
                      ? { livePromptModel: props.livePromptModel }
                      : {})}
                    {...(props.modelOptions !== undefined
                      ? { modelOptions: props.modelOptions }
                      : {})}
                    {...(props.configProviders !== undefined
                      ? { configProviders: props.configProviders }
                      : {})}
                    {...(props.contextUsage !== undefined
                      ? { contextUsage: props.contextUsage }
                      : {})}
                    {...(onRegenerate !== undefined ? { onRegenerate } : {})}
                    isNew={enteringIds.has(message.id)}
                    knownFilePaths={changedFilePathsByTurnId.get(turn.id) ?? []}
                    streaming={props.streaming}
                    activeSessionId={props.activeSessionId ?? null}
                    editingMessageId={props.editingMessageId}
                    lastUserMessageId={props.lastUserMessageId}
                    activeTheme={props.activeTheme}
                    artifactThemeKey={props.artifactThemeKey}
                    runRecordsById={props.runRecordsById ?? {}}
                    {...(message.runId !== undefined &&
                    props.runRecordsById?.[message.runId] !== undefined
                      ? { runRecord: props.runRecordsById[message.runId] }
                      : {})}
                    activeRunId={props.activeRunId ?? null}
                    activeSkill={props.activeSkill ?? null}
                    {...(props.agentLocatorAnimation
                      ? { agentLocatorAnimation: props.agentLocatorAnimation }
                      : {})}
                    permissionPrompt={props.permissionPrompt ?? null}
                    workDetailsExpanded={props.workDetailsExpanded ?? 'auto'}
                    toolDensity={props.toolDensity ?? 'comfortable'}
                    showThinking={moveFinalThinkingIntoWork ? false : props.showThinking !== false}
                    {...(props.projectPath !== undefined
                      ? { projectPath: props.projectPath }
                      : {})}
                    {...(props.toolDiffRequest !== undefined
                      ? { toolDiffRequest: props.toolDiffRequest }
                      : {})}
                    {...(props.filesChangedRequest !== undefined
                      ? { filesChangedRequest: props.filesChangedRequest }
                      : {})}
                    {...(props.onReviewChanges !== undefined
                      ? { onReviewChanges: props.onReviewChanges }
                      : {})}
                    onEdit={props.onEdit}
                    onCancelEdit={props.onCancelEdit}
                    onEditResend={props.onEditResend}
                    onRetry={props.onRetry}
                    {...(props.onRetryTurn !== undefined
                      ? { onRetryTurn: props.onRetryTurn }
                      : {})}
                    branchPoints={props.branchPoints ?? []}
                    {...(props.onSwitchBranch !== undefined
                      ? { onSwitchBranch: props.onSwitchBranch }
                      : {})}
                    {...(props.onInterventionEdit
                      ? { onInterventionEdit: props.onInterventionEdit }
                      : {})}
                    {...(props.onInterventionCancel
                      ? { onInterventionCancel: props.onInterventionCancel }
                      : {})}
                    onFeedback={props.onFeedback}
                    onInspectSubagent={props.onInspectSubagent}
                    {...(props.docCardRequest
                      ? { docCardRequest: props.docCardRequest }
                      : {})}
                    {...(props.subagentChildren
                      ? { subagentChildren: props.subagentChildren }
                      : {})}
                    {...(props.subagentInvocations
                      ? { subagentInvocations: props.subagentInvocations }
                      : {})}
                    {...(props.subagentStreams
                      ? { subagentStreams: props.subagentStreams }
                      : {})}
                    composerCard={props.composerCard}
                    {...(props.onArtifactAction
                      ? { onArtifactAction: props.onArtifactAction }
                      : {})}
                    {...(props.onOpenArtifactCanvas
                      ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                      : {})}
                    artifactPreviewEnabled={props.artifactPreviewEnabled}
                    {...(props.artifactCodeFirst !== undefined
                      ? { artifactCodeFirst: props.artifactCodeFirst }
                      : {})}
                    {...(props.artifactMaxBytes !== undefined
                      ? { artifactMaxBytes: props.artifactMaxBytes }
                      : {})}
                    {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
                    {...(props.onOpenDiff ? { onOpenDiff: props.onOpenDiff } : {})}
                    {...(props.onOpenDocument
                      ? { onOpenDocument: props.onOpenDocument }
                      : {})}
                    {...(props.locale ? { locale: props.locale } : {})}
                    {...(props.walkthroughsByMessageId
                      ? { walkthroughsByMessageId: props.walkthroughsByMessageId }
                      : {})}
                    {...(props.walkthroughEnabled !== undefined
                      ? { walkthroughEnabled: props.walkthroughEnabled }
                      : {})}
                    {...(props.walkthroughAutoGenerate !== undefined
                      ? { walkthroughAutoGenerate: props.walkthroughAutoGenerate }
                      : {})}
                    {...(props.onGenerateWalkthrough
                      ? {
                          onGenerateWalkthrough: props.onGenerateWalkthrough,
                          walkthroughEligible: isWalkthroughEligible({
                            message,
                            messages: props.messages,
                            runRecordsById: props.runRecordsById ?? {},
                            activeRunId: props.activeRunId ?? null,
                            enabled: props.walkthroughEnabled !== false,
                          }),
                        }
                      : {})}
                    {...(props.onCancelWalkthrough
                      ? { onCancelWalkthrough: props.onCancelWalkthrough }
                      : {})}
                    {...(props.onForkFromMessage
                      ? { onForkFromMessage: props.onForkFromMessage }
                      : {})}
                    {...(props.onOpenForks ? { onOpenForks: props.onOpenForks } : {})}
                    {...(props.forkCountsByMessageId
                      ? { forkCountsByMessageId: props.forkCountsByMessageId }
                      : {})}
                    {...(props.sessionLineage
                      ? { sessionLineage: props.sessionLineage }
                      : {})}
                    {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
                    {...(props.derivedActionsDisabled !== undefined
                      ? { derivedActionsDisabled: props.derivedActionsDisabled }
                      : {})}
                  />
                );
                const finalThinkingRow =
                  moveFinalThinkingIntoWork && workDisclosureOpen ? (
                    <div
                      key={`work-thinking-${message.id}`}
                      className="chat-work-thinking-row"
                      data-testid="work-folded-thinking"
                    >
                      <TurnWorkDetails
                        message={createThinkingOnlyMessage(effectiveMessage)}
                        runRecordsById={props.runRecordsById ?? {}}
                        activeRunId={null}
                        permissionPrompt={null}
                        workDetailsExpanded={props.workDetailsExpanded ?? 'auto'}
                        toolDensity={props.toolDensity ?? 'comfortable'}
                        showThinking
                        locale={props.locale ?? 'zh-CN'}
                      />
                    </div>
                  ) : null;
                const rows = finalThinkingRow ? [finalThinkingRow, row] : [row];
                return disclosureTrigger ? [disclosureTrigger, ...rows] : rows;
              })}
              {turn.id === compactionActivityTurnId && props.compactionActivity ? (
                <CompactionActivity
                  activity={props.compactionActivity}
                  locale={props.locale ?? 'zh-CN'}
                  {...(props.onCompactAbort ? { onAbort: props.onCompactAbort } : {})}
                  {...(props.onCompactDismiss ? { onDismiss: props.onCompactDismiss } : {})}
                />
              ) : null}
              {turn.id === currentResponseTurnId ? runActivitySlot : null}
            </section>
          );
        }}
      />
      {currentResponseTurnId === null && (runActivitySlot !== null || props.compactionActivity) ? (
        <section
          className="chat-turn-group is-current-response"
          data-testid="current-response-turn"
        >
          {props.compactionActivity ? (
            <CompactionActivity
              activity={props.compactionActivity}
              locale={props.locale ?? 'zh-CN'}
              {...(props.onCompactAbort ? { onAbort: props.onCompactAbort } : {})}
              {...(props.onCompactDismiss ? { onDismiss: props.onCompactDismiss } : {})}
            />
          ) : null}
          {runActivitySlot}
        </section>
      ) : null}
    </div>
  );
}
