/**
 * Scrollable assistant/user message list with edit/retry actions.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { PlanExecutionMode } from '@piwin/contracts';

import { pickArtifactFenceSecurity } from './artifact-fence-security';
import type { ChatMessageUi } from './chat-reducer';
import { AgentLocator } from './agent-locator.js';

import {
  deriveGoalSessionView,
  GoalActionsProvider,
  GoalStickyStrip,
  type GoalActions,
} from './goal';
import { focusComposerInput } from './context-menu/desktop-context-menu-value';
import { resolveAssemblySummaryForUserMessage } from './assembly-summary-capsule';
import { isWalkthroughEligible } from './walkthrough-action';
import { resolveConversationActivityKind } from './conversation-activity.js';
import { TranscriptTurnList } from './transcript-turn-list';
import { groupTranscriptTurns, turnUserMessageId } from './transcript-turns';
import { buildExploreFlowRoles } from './explore-flow';
import { collectMessageChangedFiles } from './collect-message-changed-files';
import { findStreamingCaretMessageId } from './streaming-caret';
import { DocCardSequenceView } from './DocCardSequenceView';
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
import { isDuplicateThinking } from './thinking-dedup.js';
import { CompactionActivity } from './compaction-activity.js';
import {
  ChatTurnHead,
  ChatTurnMarginalia,
  hasTurnByline,
  resolveTurnMarginalia,
} from './chat-turn-marginalia.js';
import {
  canShowPlanExecutionGate,
  findLastSuccessfulPlanPresent,
  findPlanPresentOwningRunId,
} from './plan-execution-gate.js';
import { isQueuedTurnHiddenFromTranscript } from './queued-turn-visibility.js';
import { resolveModelWaitTail } from './model-wait-tail.js';
import { RunStatusFooter } from './run-status-footer.js';

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

export type { ChatThreadProps } from './chat-thread-types.js';
import type { ChatThreadProps } from './chat-thread-types.js';

export function ChatThread(props: ChatThreadProps): ReactElement {
  // Quiet workbench: msg-in only for messages that arrive after first mount
  // (history hydrate must not replay entrance animation).
  const knownIdsRef = useRef<Set<string> | null>(null);
  const isInitialMountRef = useRef(true);
  const knownSessionRef = useRef(props.sessionId ?? 'none');
  const sessionKey = props.sessionId ?? 'none';
  if (knownIdsRef.current === null || knownSessionRef.current !== sessionKey || props.hydrating) {
    knownSessionRef.current = sessionKey;
    knownIdsRef.current = new Set(props.messages.map((message) => message.id));
    isInitialMountRef.current = true;
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
      props.messages.filter((message) => !isQueuedTurnHiddenFromTranscript(message)),
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
  const conversationSession = props.isConversationSession === true;
  const effectiveTail = chatMessages[chatMessages.length - 1];
  // Agent sessions carry live run state on RunStatusFooter (rendered per turn).
  const showRunActivity =
    conversationSession &&
    props.streaming &&
    !props.permissionPrompt &&
    (chatMessages.length === 0 || effectiveTail?.role === 'user');
  const conversationActivityKind = conversationSession
    ? resolveConversationActivityKind({
        streaming: props.streaming,
        tools: transcriptMessages.flatMap((message) => message.tools),
      })
    : null;
  // An agent run accepted before its user row lands has no turn to foot yet.
  const pendingRunStatusFooter =
    !conversationSession &&
    props.streaming === true &&
    !props.permissionPrompt &&
    !props.compactionActivity &&
    chatMessages.length === 0;
  const runActivitySlot =
    showRunActivity && conversationActivityKind ? (
      <div key="conversation-activity-slot" className="chat-run-activity-line" data-testid="conversation-activity">
        <div className="agent-locator-stack">
          <AgentLocator
            input={{
              kind:
                conversationActivityKind === 'stopping'
                  ? 'stopping'
                  : conversationActivityKind === 'thinking'
                    ? 'waiting-first-token'
                    : 'working',
              locale: props.locale ?? 'zh-CN',
            }}
            {...(props.agentLocatorAnimation ? { animation: props.agentLocatorAnimation } : {})}
          />
        </div>
      </div>
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

  // The Goal loop's real phase, derived from the goal_* tool calls in the
  // transcript rather than from run streaming state (see goal-session-model).
  const goalView = useMemo(
    () =>
      deriveGoalSessionView({
        messages: props.messages,
        streaming: props.streaming,
        agentMode: props.composerCard.agentMode,
      }),
    [props.messages, props.streaming, props.composerCard.agentMode],
  );

  // Goal cards sit several levels down the transcript; their actions travel by
  // context rather than through every intermediate component's props.
  const onAgentModeChange = props.composerCard.onAgentModeChange;
  const onReviewChanges = props.onReviewChanges;
  const goalActions = useMemo<GoalActions>(
    () => ({
      focusComposer: () => focusComposerInput(),
      leaveGoalMode: () => onAgentModeChange('agent'),
      ...(onReviewChanges ? { reviewChanges: onReviewChanges } : {}),
    }),
    [onAgentModeChange, onReviewChanges],
  );

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
    <GoalActionsProvider actions={goalActions}>
    <div
      className={`chat-thread${conversationSession ? ' is-conversation' : ''}`}
      data-testid="chat-thread"
    >
      {docCardSequence && props.docCardRequest ? (
        <div className="chat-doc-card-sequence-slot">
          <DocCardSequenceView sequence={docCardSequence} request={props.docCardRequest} />
        </div>
      ) : null}
      {goalView.phase !== 'idle' && props.messages.length > 0 ? (
        <GoalStickyStrip
          view={goalView}
          messages={props.messages}
          onAbort={props.composerCard.onAbort}
          onExit={() => props.composerCard.onAgentModeChange('agent')}
        />
      ) : null}
      <TranscriptTurnList
        turns={turnGroups}
        pinnedMessageId={props.editingMessageId}
        streaming={props.streaming === true}
        renderTurn={(turn) => {
          const turnMessages = turn.items.map((item) => item.message);
          // Tool round settled, next model token not here yet: the run status
          // footer switches to the model-wait phrase and the empty
          // `message/start` placeholders it stands in for stay hidden.
          const modelWaitTail =
            !conversationSession && turn.id === currentResponseTurnId
              ? resolveModelWaitTail({
                  messages: turnMessages,
                  streaming: props.streaming === true,
                  activeRunId: props.activeRunId ?? null,
                  runRecordsById: props.runRecordsById ?? {},
                  permissionPending: Boolean(props.permissionPrompt),
                })
              : null;
          const currentTurnStreaming =
            turn.id === currentResponseTurnId && props.streaming === true;
          const turnModel =
            turnMessages.find((item) => item.model)?.model ??
            (conversationSession && currentTurnStreaming
              ? (props.livePromptModel ?? undefined)
              : undefined);
          const turnFlashcardTools = collectFlashcardToolsFromMessages(turnMessages);
          const turnTools = turnMessages.flatMap((item) => item.tools);
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
          const isLatestTurnForDisclosure = turn.id === currentResponseTurnId;
          const workDisclosureDefaultOpen =
            props.workDetailsExpanded === 'always' ||
            (props.workDetailsExpanded !== 'collapsed' &&
              !conversationSession &&
              isLatestTurnForDisclosure);
          const workDisclosureOpen =
            workDisclosureOpenByTurnId[workDisclosureKey] ?? workDisclosureDefaultOpen;
          const identityItemIndex = conversationChrome?.identityMessageId
            ? turn.items.findIndex(
                (item) => item.message.id === conversationChrome.identityMessageId,
              )
            : -1;
          // Lift identity above the work trigger in both states. Collapsing
          // used to park the avatar above the trigger, then expanding put it
          // back on the first work row — the focused trigger jumped in front.
          const identityLiftedAboveWorkDisclosure =
            identityItemIndex >= 0 &&
            workDisclosureProjection !== null &&
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
          const userMessages = turn.items
            .filter((item) => item.message.role === 'user')
            .map((item) => item.message);
          const assistantMessages = turn.items
            .filter((item) => item.message.role !== 'user')
            .map((item) => item.message);
          const turnPlanDisplay = conversationSession
            ? null
            : findLastSuccessfulPlanPresent(assistantMessages);
          const presentOwningRunId = conversationSession
            ? undefined
            : findPlanPresentOwningRunId(assistantMessages);

          const renderedUserItems: ReactElement[] = [];
          const renderedAssistantItems: ReactElement[] = [];

          turn.items.forEach(({ message, messageIndex }, itemIndex) => {
            if (modelWaitTail?.placeholderMessageIds.includes(message.id)) {
              return;
            }
            const planDisplay =
              turn.lastAssistantMessageId === message.id ? turnPlanDisplay : null;
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
            const liftedIdentityHeader =
              identityLiftedAboveWorkDisclosure &&
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
            if (isDisclosureWorkItem && !workDisclosureOpen && !planDisplay) {
              const collapsedNodes = [liftedIdentityHeader, disclosureTrigger].filter(
                (node): node is ReactElement => node !== null,
              );
              if (message.role === 'user') {
                renderedUserItems.push(...collapsedNodes);
              } else {
                renderedAssistantItems.push(...collapsedNodes);
              }
              return;
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
                // Project/Agent: keepPrevious regenerate stacks answer siblings
                // without reverting disk. Explore via edit/branch; repair via
                // error-card retry (keepPrevious: false).
                const onRegenerate =
                  conversationSession &&
                  isLatestAssistant &&
                  precedingUser &&
                  props.onRetryTurn
                    ? () => props.onRetryTurn?.(precedingUser.id, { keepPrevious: true })
                    : undefined;
                const exploreRole = exploreRolesByMessageId.get(message.id);
                const priorThinking = turn.items
                  .slice(0, itemIndex)
                  .filter(
                    (item) =>
                      item.message.role === 'assistant' &&
                      item.message.thinking.trim().length > 0,
                  )
                  .map((item) => item.message.thinking);
                const isThinkingDuplicate =
                  message.role === 'assistant' &&
                  message.thinking.trim().length > 0 &&
                  isDuplicateThinking(message.thinking, priorThinking);
                const moveFinalThinkingIntoWork =
                  !conversationSession &&
                  workDisclosureProjection !== null &&
                  itemIndex === workDisclosureProjection.endIndex + 1 &&
                  message.role === 'assistant' &&
                  message.thinking.trim().length > 0 &&
                  !isThinkingDuplicate &&
                  props.showThinking !== false &&
                  exploreRole === undefined;
                const effectiveMessage =
                  conversationSession &&
                  message.role === 'assistant' &&
                  !message.model &&
                  turnModel
                    ? { ...message, model: turnModel }
                    : message;
                const turnStillLive =
                  currentTurnStreaming &&
                  (message.status === 'streaming' ||
                    (message.runId !== undefined && message.runId === props.activeRunId));
                const owningRunId = presentOwningRunId ?? message.runId;
                const owningRun =
                  owningRunId !== undefined
                    ? props.runRecordsById?.[owningRunId]
                    : undefined;
                const presentRunStillLive =
                  presentOwningRunId !== undefined && presentOwningRunId === props.activeRunId;
                const planExecutionGate =
                  planDisplay &&
                  props.onPlanExecute &&
                  canShowPlanExecutionGate({
                    plan: planDisplay.plan,
                    isConversationSession: conversationSession,
                    streaming: currentTurnStreaming || presentRunStillLive || turnStillLive,
                    ...(owningRun?.outcome !== undefined ? { runOutcome: owningRun.outcome } : {}),
                    ...(owningRun?.status !== undefined ? { runStatus: owningRun.status } : {}),
                  })
                    ? {
                        plan: planDisplay.plan,
                        planPath: planDisplay.path,
                        displayPath: planDisplay.displayPath,
                        ...(props.sessionPlan !== undefined
                          ? { livePlan: props.sessionPlan }
                          : {}),
                        onExecute: (mode: PlanExecutionMode) =>
                          props.onPlanExecute?.(planDisplay, mode),
                        captureKeyboard: false,
                      }
                    : undefined;
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
                            !identityLiftedAboveWorkDisclosure,
                          showConversationTurnUsage:
                            conversationChrome.showUsageOnIdentity &&
                            !identityLiftedAboveWorkDisclosure,
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
                    turnTools={turnTools}
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
                    {...(planExecutionGate ? { planExecutionGate } : {})}
                    {...(onRegenerate !== undefined ? { onRegenerate } : {})}
                    isNew={enteringIds.has(message.id)}
                    knownFilePaths={changedFilePathsByTurnId.get(turn.id) ?? []}
                    streaming={props.streaming}
                    activeSessionId={props.activeSessionId ?? null}
                    editingMessageId={props.editingMessageId}
                    lastUserMessageId={props.lastUserMessageId}
                    {...(turnUserMessageId(turn) !== null
                      ? { turnUserMessageId: turnUserMessageId(turn) }
                      : {})}
                    activeTheme={props.activeTheme}
                    artifactThemeKey={props.artifactThemeKey}
                    runRecordsById={props.runRecordsById ?? {}}
                    {...(message.runId !== undefined &&
                    props.runRecordsById?.[message.runId] !== undefined
                      ? { runRecord: props.runRecordsById[message.runId] }
                      : {})}
                    activeRunId={props.activeRunId ?? null}
                    permissionPrompt={props.permissionPrompt ?? null}
                    {...(props.onPermission !== undefined ? { onPermission: props.onPermission } : {})}
                    workDetailsExpanded={props.workDetailsExpanded ?? 'auto'}
                    toolDensity={props.toolDensity ?? 'comfortable'}
                    showThinking={
                      isThinkingDuplicate || moveFinalThinkingIntoWork
                        ? false
                        : props.showThinking !== false
                    }
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
                    {...(props.onBranchResend !== undefined
                      ? { onBranchResend: props.onBranchResend }
                      : {})}
                    {...(props.onRetryTurn !== undefined
                      ? { onRetryTurn: props.onRetryTurn }
                      : {})}
                    {...(props.onContinueTurn !== undefined
                      ? { onContinueTurn: props.onContinueTurn }
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
                    {...pickArtifactFenceSecurity(props)}
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
                const leadingChrome = [
                  liftedIdentityHeader,
                  disclosureTrigger,
                ].filter((node): node is ReactElement => node !== null);
                const itemNodes = leadingChrome.length > 0
                  ? [...leadingChrome, ...rows]
                  : rows;
                if (message.role === 'user') {
                  renderedUserItems.push(...itemNodes);
                } else {
                  renderedAssistantItems.push(...itemNodes);
                }
              });

              if (turn.id === compactionActivityTurnId && props.compactionActivity) {
                const compactionNode = (
                  <CompactionActivity
                    key={`compaction-${turn.id}`}
                    activity={props.compactionActivity}
                    locale={props.locale ?? 'zh-CN'}
                    {...(props.onCompactAbort ? { onAbort: props.onCompactAbort } : {})}
                  />
                );
                renderedAssistantItems.push(compactionNode);
              }

              if (turn.id === currentResponseTurnId && runActivitySlot) {
                renderedAssistantItems.push(runActivitySlot);
              }

              // One live line at the foot of the running turn. Permission gates
              // and compaction own their chrome while they are up.
              const showRunStatusFooter =
                !conversationSession &&
                currentTurnStreaming &&
                !props.permissionPrompt &&
                !(turn.id === compactionActivityTurnId && props.compactionActivity);
              if (showRunStatusFooter) {
                renderedAssistantItems.push(
                  <RunStatusFooter
                    key={`run-status-${turn.id}`}
                    messages={turnMessages}
                    activeRunId={props.activeRunId ?? null}
                    runRecordsById={props.runRecordsById ?? {}}
                    modelWaitTail={modelWaitTail}
                    locale={props.locale ?? 'zh-CN'}
                    {...(props.agentLocatorAnimation
                      ? { animation: props.agentLocatorAnimation }
                      : {})}
                    {...(props.activeSkill ? { skill: props.activeSkill } : {})}
                  />,
                );
              }

              const hasAssistantActivity =
                renderedAssistantItems.length > 0 ||
                (currentTurnStreaming && (props.activeRunId !== null || runActivitySlot !== null));

              const userMarginaliaResolved =
                renderedUserItems.length === 0
                  ? null
                  : resolveTurnMarginalia(userMessages, {
                      editingMessageId: props.editingMessageId,
                      locale: props.locale,
                      forceRole: 'user',
                      isConversationSession: conversationSession,
                    });
              const userMarginaliaData =
                userMarginaliaResolved !== null && hasTurnByline(userMarginaliaResolved)
                  ? userMarginaliaResolved
                  : null;

              const assistantStatus = currentTurnStreaming
                ? props.permissionPrompt
                  ? props.locale === 'en'
                    ? 'Waiting'
                    : '等待批准'
                  : props.locale === 'en'
                    ? 'Running'
                    : '运行中'
                : null;

              const assistantMarginaliaData =
                !hasAssistantActivity
                  ? null
                  : resolveTurnMarginalia(
                      assistantMessages.length > 0 ? assistantMessages : turnMessages,
                      {
                        locale: props.locale,
                        forceRole: 'assistant',
                        model: turnModel,
                        elapsedMs: workDisclosureProjection?.elapsedMs,
                        contextUsage: props.contextUsage,
                        status: assistantStatus,
                        statusTone: currentTurnStreaming
                          ? props.permissionPrompt
                            ? 'waiting'
                            : 'running'
                          : null,
                        isConversationSession: conversationSession,
                      },
                    );

              return (
                <section
                  key={turn.id}
                  className={`chat-turn-group${turn.id === currentResponseTurnId ? ' is-current-response' : ''}`}
                  {...(turn.id === currentResponseTurnId
                    ? { 'data-testid': 'current-response-turn' }
                    : {})}
                >
                  {renderedUserItems.length > 0 ? (
                    <article key="user-turn" className="turn chat-turn chat-turn-user">
                      <div className="chat-turn-body">
                        {userMarginaliaData !== null ? <ChatTurnHead data={userMarginaliaData} /> : null}
                        {renderedUserItems}
                      </div>
                      {userMarginaliaData !== null ? <ChatTurnMarginalia data={userMarginaliaData} /> : null}
                    </article>
                  ) : null}
                  {hasAssistantActivity ? (
                    <article key="assistant-turn" className="turn chat-turn chat-turn-assistant">
                      {assistantMarginaliaData !== null ? <ChatTurnMarginalia data={assistantMarginaliaData} /> : null}
                      <div className="chat-turn-body">
                        {assistantMarginaliaData !== null ? <ChatTurnHead data={assistantMarginaliaData} /> : null}
                        {renderedAssistantItems}
                      </div>
                    </article>
                  ) : null}
                </section>
              );
            }}
      />
      {currentResponseTurnId === null &&
      (runActivitySlot !== null || pendingRunStatusFooter || props.compactionActivity) ? (
        <section
          className="chat-turn-group is-current-response"
          data-testid="current-response-turn"
        >
          {props.compactionActivity ? (
            <CompactionActivity
              activity={props.compactionActivity}
              locale={props.locale ?? 'zh-CN'}
              {...(props.onCompactAbort ? { onAbort: props.onCompactAbort } : {})}
            />
          ) : null}
          {runActivitySlot}
          {pendingRunStatusFooter ? (
            <RunStatusFooter
              messages={[]}
              activeRunId={props.activeRunId ?? null}
              runRecordsById={props.runRecordsById ?? {}}
              modelWaitTail={null}
              locale={props.locale ?? 'zh-CN'}
              {...(props.agentLocatorAnimation ? { animation: props.agentLocatorAnimation } : {})}
              {...(props.activeSkill ? { skill: props.activeSkill } : {})}
            />
          ) : null}
        </section>
      ) : null}
      </div>
    </GoalActionsProvider>
  );
}
