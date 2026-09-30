/**
 * Scrollable assistant/user message list with edit/retry actions.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { PlanExecutionMode, TranscriptBranchPoint } from '@piwin/contracts';

import { pickArtifactFenceSecurity } from './artifact-fence-security';
import type { ChatMessageUi } from './chat-reducer';

import {
  GoalActionsProvider,
  type GoalActions,
} from './goal';
import { focusComposerInput } from './context-menu/desktop-context-menu-value';
import { resolveAssemblySummaryForUserMessage } from './assembly-summary-capsule';
import { isWalkthroughEligible } from './walkthrough-action';
import { TranscriptTurnList } from './transcript-turn-list';
import { groupTranscriptTurns, turnUserMessageId } from './transcript-turns';
import { resolveTurnModelTrail } from './turn-model-trail';
import { buildExploreFlowRoles } from './explore-flow';
import { collectMessageChangedFiles } from './collect-message-changed-files';
import { findStreamingCaretMessageId } from './streaming-caret';
import { DocCardSequenceView } from './DocCardSequenceView';
import { ChatMessageRow } from './chat-message-row';
import { RenderErrorBoundary } from './render-error-boundary.js';
import { collectFlashcardToolsFromMessages } from './conversation-response-content.js';
import {
  buildConversationTurnUsageChip,
  ConversationTurnIdentityHeader,
} from './conversation-message-header';
import { resolveConversationTurnChrome } from './conversation-turn-chrome';
import { resolveHiddenLifecyclePlaceholderIds } from './lifecycle-placeholder.js';
import { projectTurnWorkDisclosure } from './turn-work-disclosure-model.js';
import { TurnWorkDisclosure } from './turn-work-disclosure.js';
import {
  resolveWorkDisclosureOpen,
  toggleWorkDisclosureOverride,
  type WorkDisclosureOverride,
} from './turn-work-disclosure-open-state.js';
import { TurnWorkDetails } from './turn-work-details.js';
import { planTurnWorkSegments, resolveTurnFoldKey } from './turn-work-segment-plan.js';
import { mountTurnWorkSegmentBlocks, TurnWorkSegmentEarlier } from './turn-work-segment.js';
import { useTurnWorkSegmentState } from './use-turn-work-segment-state.js';
import { setWorkChainCompact, useWorkChainCompact } from './work-chain-compact.js';
import { isDuplicateThinking } from './thinking-dedup.js';
import { CompactionActivity } from './compaction-activity.js';
import { isCompactionRunning } from './compaction-seam-model.js';
import { ChatTurnSection } from './chat-turn-section.js';
import {
  canShowPlanExecutionGate,
  findLastSuccessfulPlanPresent,
  findPlanPresentOwningRunId,
} from './plan-execution-gate.js';
import { isQueuedTurnHiddenFromTranscript } from './queued-turn-visibility.js';
import { resolveModelWaitTail } from './model-wait-tail.js';
import { RunStatusFooter } from './run-status-footer.js';
import { encodeTurnRunIds } from './turn-changes/turn-change-index.js';
import { TranscriptSelectionToolbar } from './transcript-selection-toolbar.js';

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

/**
 * Stable defaults. A fresh `[]` per render failed the reference check in
 * `areChatMessageRowPropsEqual` for every user row on every push.
 */
const EMPTY_BRANCH_POINTS: TranscriptBranchPoint[] = [];
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
    Record<string, WorkDisclosureOverride>
  >({});
  const segmentState = useTurnWorkSegmentState();
  const workChainCompact = useWorkChainCompact();
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
  // Messages whose tools already render inside an explore capsule. The
  // turn-level fold skips a chain that group has covered on its own.
  const exploreFoldedMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [messageId, role] of exploreRolesByMessageId) {
      if (role.kind === 'anchor' || role.kind === 'member') ids.add(messageId);
    }
    return ids;
  }, [exploreRolesByMessageId]);
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
  // A run accepted before its user row lands has no turn to foot yet.
  const pendingRunStatusFooter =
    props.streaming === true &&
    !props.permissionPrompt &&
    !isCompactionRunning(props.compactionActivity) &&
    chatMessages.length === 0;
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

  const threadRef = useRef<HTMLDivElement>(null);

  return (
    <GoalActionsProvider actions={goalActions}>
    <div
      ref={threadRef}
      className={`chat-thread${conversationSession ? ' is-conversation' : ''}`}
      data-testid="chat-thread"
    >
      {docCardSequence && props.docCardRequest ? (
        <div className="chat-doc-card-sequence-slot">
          <DocCardSequenceView sequence={docCardSequence} request={props.docCardRequest} />
        </div>
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
            turn.id === currentResponseTurnId
              ? resolveModelWaitTail({
                  messages: turnMessages,
                  streaming: props.streaming === true,
                  activeRunId: props.activeRunId ?? null,
                  runRecordsById: props.runRecordsById ?? {},
                  permissionPending: Boolean(props.permissionPrompt),
                })
              : null;
          // Empty `message/start` rows anywhere in a live turn, not just the
          // one the model-wait footer stands in for.
          const hiddenPlaceholderIds = resolveHiddenLifecyclePlaceholderIds({
            messages: turnMessages,
            streaming: props.streaming === true,
            showThinking: props.showThinking !== false,
            permissionPending: Boolean(props.permissionPrompt),
          });
          const currentTurnStreaming =
            turn.id === currentResponseTurnId && props.streaming === true;
          // Latest, not first: a turn that switched models mid-run is
          // answered by the one it switched to.
          const turnModel =
            resolveTurnModelTrail(turnMessages).latest ??
            turnMessages.find((item) => item.model)?.model ??
            (conversationSession && currentTurnStreaming
              ? (props.livePromptModel ?? undefined)
              : undefined);
          const turnFlashcardTools = collectFlashcardToolsFromMessages(turnMessages);
          const turnTools = turnMessages.flatMap((item) => item.tools);
          const turnRunKey = encodeTurnRunIds(turnMessages.map((item) => item.runId));
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
            permissionPending: Boolean(props.permissionPrompt),
            exploreFoldedMessageIds,
          });
          const workDisclosureKey = `${props.sessionId ?? 'session'}:${resolveTurnFoldKey(turn)}`;
          // 详细 means detailed: nothing the agent did sits behind a summary
          // the user has to click. An explicit per-turn toggle still wins.
          // A live chain with a failed tool stays open so the failure is on
          // screen, but the header is still there to collapse it.
          const workDisclosureDefaultOpen =
            props.workDetailsExpanded === 'always' ||
            props.toolDensity === 'detailed' ||
            (workDisclosureProjection?.live === true &&
              workDisclosureProjection.failureCount > 0);
          const workDisclosureOpen = resolveWorkDisclosureOpen(
            workDisclosureOpenByTurnId[workDisclosureKey],
            workDisclosureProjection,
            turnRunKey,
            workDisclosureDefaultOpen,
          );
          // An open fold lists narration segments; only open ones build rows.
          const segmentPlan =
            workDisclosureOpen && workDisclosureProjection !== null && !conversationSession
              ? planTurnWorkSegments({
                  turn,
                  projection: workDisclosureProjection,
                  compact: workChainCompact,
                  expandAll:
                    props.workDetailsExpanded === 'always' || props.toolDensity === 'detailed',
                  windowSize: segmentState.windowSizeFor(workDisclosureKey),
                  openOverrides: segmentState.openOverrides,
                })
              : null;
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

          // The seam sits right after its anchor message so whatever the agent
          // does next lands below it. Appending it to the end of the turn would
          // leave every post-compaction row above the seam.
          const turnCompaction =
            turn.id === compactionActivityTurnId ? (props.compactionActivity ?? null) : null;
          const compactionAnchorIndex =
            turnCompaction === null
              ? -1
              : turn.items.findIndex((item) => item.message.id === turnCompaction.anchorMessageId);
          let compactionInsertAt = -1;
          // Every earlier assistant's reasoning, collected once per turn: a
          // per-row slice of the turn was quadratic on a 600-step chain.
          const priorThinkingTexts: string[] = [];

          turn.items.forEach(({ message, messageIndex }, itemIndex) => {
            // Recorded before this item's early returns: a hidden placeholder
            // right after the anchor must not push the seam past it.
            if (compactionAnchorIndex >= 0 && itemIndex === compactionAnchorIndex + 1) {
              compactionInsertAt = renderedAssistantItems.length;
            }
            const priorThinkingCount = priorThinkingTexts.length;
            if (message.role === 'assistant' && message.thinking.trim().length > 0) {
              priorThinkingTexts.push(message.thinking);
            }
            const planDisplay =
              turn.lastAssistantMessageId === message.id ? turnPlanDisplay : null;
            // A placeholder still owns its row when the turn hung chrome on it:
            // a plan gate, or the Conversation identity header.
            if (
              (modelWaitTail?.placeholderMessageIds.includes(message.id) === true ||
                hiddenPlaceholderIds.has(message.id)) &&
              !planDisplay &&
              conversationChrome?.identityMessageId !== message.id
            ) {
              return;
            }
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
                  {...(segmentPlan !== null
                    ? { compact: workChainCompact, onCompactChange: setWorkChainCompact }
                    : {})}
                  onToggle={() =>
                    setWorkDisclosureOpenByTurnId((current) => ({
                      ...current,
                      [workDisclosureKey]: toggleWorkDisclosureOverride(
                        current[workDisclosureKey],
                        workDisclosureProjection,
                        turnRunKey,
                        workDisclosureDefaultOpen,
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
            const segment =
              isDisclosureWorkItem && !planDisplay && message.role !== 'user'
                ? segmentPlan?.byItem.get(itemIndex)
                : undefined;
            if (segment !== undefined && segmentPlan !== null) {
              // The fold header (and the older-segments button under it) stay
              // put; rows go into the segment's block, and only when open.
              for (const node of [liftedIdentityHeader, disclosureTrigger]) {
                if (node !== null) renderedAssistantItems.push(node);
              }
              if (isDisclosureStart && segmentPlan.hiddenCount > 0) {
                renderedAssistantItems.push(
                  <TurnWorkSegmentEarlier
                    key={`work-segment-earlier-${turn.id}`}
                    hiddenCount={segmentPlan.hiddenCount}
                    locale={props.locale ?? 'zh-CN'}
                    onShowMore={() => segmentState.showEarlier(workDisclosureKey)}
                  />,
                );
              }
              if (!segmentPlan.isVisible(segment)) return;
              if (!segmentPlan.slots.has(segment.id)) {
                segmentPlan.slots.set(segment.id, { at: renderedAssistantItems.length, rows: [] });
                renderedAssistantItems.push(<Fragment key={segment.id} />);
              }
              if (!segmentPlan.isOpen(segment)) return;
            }
                const followingAssistantRunId =
                  message.role === 'user'
                    ? turn.items
                        .slice(itemIndex + 1)
                        .find((item) => item.message.role === 'assistant' && item.message.runId)
                        ?.message.runId
                    : undefined;
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
                // R1/R2: `turnTools` and `turnFlashcardTools` are rebuilt on every
                // ChatThread render. Only two row shapes read them —
                // ChatTurnFilesSummary on the turn's last assistant, and
                // turnAttemptHasRetainedWork on an errored row. Handing the array
                // to every row failed the reference check for the whole turn.
                const isLastAssistantRow = turn.lastAssistantMessageId === message.id;
                const rowNeedsTurnTools = isLastAssistantRow || message.status === 'error';
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
                const isThinkingDuplicate =
                  message.role === 'assistant' &&
                  message.thinking.trim().length > 0 &&
                  isDuplicateThinking(message.thinking, priorThinkingTexts, priorThinkingCount);
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
                    turnInProgress={currentTurnStreaming}
                    {...(rowNeedsTurnTools ? { turnTools } : {})}
                    {...(isLastAssistantRow && turnRunKey ? { turnRunKey } : {})}
                    {...(isLastAssistantRow && turnFlashcardTools.length > 0
                      ? { turnFlashcardTools }
                      : {})}
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
                    {...(isLatestAssistant && props.contextUsage !== undefined
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
                    branchPoints={props.branchPoints ?? EMPTY_BRANCH_POINTS}
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
                    artifactInlineEnabled={props.artifactInlineEnabled}
                    artifactCanvasEnabled={props.artifactCanvasEnabled ?? props.artifactInlineEnabled}
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
                // One bad message must not blank the conversation: contain the
                // row locally so the app-level boundary stays idle.
                const containedRow = (
                  <RenderErrorBoundary
                    key={message.id}
                    locale={props.locale ?? 'zh-CN'}
                    surface="message"
                    resetKey={`${message.id}:${effectiveMessage.status}:${effectiveMessage.text.length}`}
                  >
                    {row}
                  </RenderErrorBoundary>
                );
                const rows = finalThinkingRow
                  ? [finalThinkingRow, containedRow]
                  : [containedRow];
                const segmentSlot =
                  segment !== undefined ? segmentPlan?.slots.get(segment.id) : undefined;
                if (segmentSlot !== undefined) {
                  segmentSlot.rows.push(...rows);
                  return;
                }
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

              if (segmentPlan !== null) {
                mountTurnWorkSegmentBlocks(renderedAssistantItems, segmentPlan, {
                  locale: props.locale ?? 'zh-CN',
                  onToggle: segmentState.toggleSegment,
                });
              }

              if (turnCompaction !== null) {
                renderedAssistantItems.splice(
                  compactionInsertAt >= 0 ? compactionInsertAt : renderedAssistantItems.length,
                  0,
                  <CompactionActivity
                    key={`compaction-${turn.id}`}
                    activity={turnCompaction}
                    locale={props.locale ?? 'zh-CN'}
                    {...(props.onCompactAbort ? { onAbort: props.onCompactAbort } : {})}
                  />,
                );
              }

              // One live line at the foot of the running turn. A permission gate
              // owns the foot while it is up, and so does a compaction that is
              // still running; a settled one must not keep the footer hidden.
              const showRunStatusFooter =
                currentTurnStreaming &&
                !props.permissionPrompt &&
                !(turnCompaction !== null && isCompactionRunning(turnCompaction));
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

              return (
                <ChatTurnSection
                  key={turn.id}
                  turnId={turn.id}
                  isCurrentResponse={turn.id === currentResponseTurnId}
                  userMessages={userMessages}
                  assistantMessages={assistantMessages}
                  turnMessages={turnMessages}
                  userItems={renderedUserItems}
                  assistantItems={renderedAssistantItems}
                  assistantPending={currentTurnStreaming && props.activeRunId !== null}
                  liveState={
                    currentTurnStreaming ? (props.permissionPrompt ? 'waiting' : 'running') : null
                  }
                  editingMessageId={props.editingMessageId}
                  locale={props.locale}
                  isConversationSession={conversationSession}
                  model={turnModel}
                  contextUsage={props.contextUsage}
                />
              );
            }}
      />
      {currentResponseTurnId === null &&
      (pendingRunStatusFooter || props.compactionActivity) ? (
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
      <TranscriptSelectionToolbar
        containerRef={threadRef}
        projectPath={props.projectPath}
        locale={props.locale}
      />
      </div>
    </GoalActionsProvider>
  );
}
