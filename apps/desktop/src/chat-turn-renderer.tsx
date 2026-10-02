import { TurnWorkEarlier } from './turn-work-earlier.js';
/**
 * Per-turn transcript rendering extracted from ChatThread.
 * Session-level state stays in chat-thread.tsx; this module owns one turn's DOM.
 */
import { Fragment, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import type { PlanExecutionMode } from '@piwin/contracts';

import type { ChatMessageUi } from './chat-reducer';
import type { ChatThreadProps } from './chat-thread-types.js';
import { resolveAssemblySummaryForUserMessage } from './assembly-summary-capsule';
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
import { planTurnWorkSegments } from './turn-work-segment-plan.js';
import { resolveSegmentLiveActions } from './turn-work-segments.js';
import { mountTurnWorkSegmentBlocks, TurnWorkSegmentEarlier } from './turn-work-segment.js';
import type { TurnWorkSegmentState } from './use-turn-work-segment-state.js';
import { isDuplicateThinking } from './thinking-dedup.js';
import { CompactionActivity } from './compaction-activity.js';
import { isCompactionRunning } from './compaction-seam-model.js';
import { ChatTurnSection } from './chat-turn-section.js';
import {
  canShowPlanExecutionGate,
  findLastSuccessfulPlanPresent,
  findPlanPresentOwningRunId,
} from './plan-execution-gate.js';
import { resolveModelWaitTail } from './model-wait-tail.js';
import { RunStatusFooter } from './run-status-footer.js';
import { encodeTurnRunIds } from './turn-changes/turn-change-index.js';
import { resolveTurnModelTrail } from './turn-model-trail';
import type { TranscriptTurn } from './transcript-turns';
import {
  narrationOnlyMessage,
  withoutNarration,
} from './chat-turn-narration-split.js';
import type { ExploreFlowRole } from './explore-flow.js';
import {
  buildChatTurnRowProps,
  chatTurnRowKey,
  type ChatTurnRowBuildContext,
  type ChatTurnRowPart,
} from './chat-turn-row-props.js';

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

export type ChatTurnRenderInput = {
  turn: TranscriptTurn;
  workflowActivity?: ReactElement | null;
  workflowActive?: boolean;
  props: ChatThreadProps;
  conversationSession: boolean;
  currentResponseTurnId: string | null;
  compactionActivityTurnId: string | null;
  latestAssistantMessageId: string | null;
  precedingUser: ChatMessageUi | undefined;
  streamingCaretMessageId: string | null;
  exploreRolesByMessageId: ReadonlyMap<string, ExploreFlowRole>;
  exploreFoldedMessageIds: ReadonlySet<string>;
  workDisclosureOpenByTurnId: Record<string, WorkDisclosureOverride>;
  setWorkDisclosureOpenByTurnId: Dispatch<
    SetStateAction<Record<string, WorkDisclosureOverride>>
  >;
  segmentState: TurnWorkSegmentState;
  enteringIds: ReadonlySet<string>;
  changedFilePathsByTurnId: ReadonlyMap<string, readonly string[]>;
};

export function renderChatTurn(input: ChatTurnRenderInput): ReactElement {
  const {
    turn,
    props,
    conversationSession,
    currentResponseTurnId,
    compactionActivityTurnId,
    latestAssistantMessageId,
    precedingUser,
    streamingCaretMessageId,
    exploreRolesByMessageId,
    exploreFoldedMessageIds,
    workDisclosureOpenByTurnId,
    setWorkDisclosureOpenByTurnId,
    segmentState,
    enteringIds,
    changedFilePathsByTurnId,
  } = input;
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
  const workDisclosureKey = `${props.sessionId ?? 'session'}:${turn.id}`;
  // 详细 means detailed: nothing the agent did sits behind a summary
  // the user has to click. An explicit per-turn toggle still wins.
  // A live chain is open by default: it is what the reader is watching, and
  // a failure shows up in it as it happens. It folds into 已工作 once, when
  // the turn settles — i.e. when the conclusion is out.
  const workDisclosureDefaultOpen =
    props.workDetailsExpanded === 'always' ||
    props.toolDensity === 'detailed' ||
    workDisclosureProjection?.live === true;
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
        <Fragment key={`work-disclosure-${turn.id}`}>
        <TurnWorkDisclosure
          key={`work-disclosure-${turn.id}`}
          foldId={`turn:${workDisclosureKey}`}
          projection={workDisclosureProjection}
          open={workDisclosureOpen}
          locale={props.locale ?? 'zh-CN'}
          segmented={segmentPlan !== null}
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
        {workDisclosureOpen && props.onLoadEarlierWork ? (
          <TurnWorkEarlier turn={turn} locale={props.locale ?? 'zh-CN'} onLoad={props.onLoadEarlierWork} />
        ) : null}
        </Fragment>
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
    // The segment's narration is prose, not work: it shows even while
    // the segment's tools stay folded.
    const isSegmentNarration =
      segment !== undefined &&
      segment.narrationItemIndex === itemIndex &&
      message.text.trim().length > 0;
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
        segmentPlan.slots.set(segment.id, {
          at: renderedAssistantItems.length,
          prose: [],
          rows: [],
        });
        renderedAssistantItems.push(<Fragment key={segment.id} />);
      }
      if (!segmentPlan.isOpen(segment) && !isSegmentNarration) return;
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
        // One message can render as `prose` (narration, outside the
        // fold) and `work` (tools, inside it); `whole` is the ordinary row.
        const rowContext: ChatTurnRowBuildContext = {
          props,
          turn,
          message,
          messageIndex,
          conversationSession,
          conversationChrome,
          identityLiftedAboveWorkDisclosure,
          exploreRole,
          assemblySummary,
          streamingCaretMessageId,
          currentTurnStreaming,
          rowNeedsTurnTools,
          isLastAssistantRow,
          turnTools,
          turnRunKey,
          turnFlashcardTools,
          isLatestAssistant,
          onRegenerate,
          enteringIds,
          changedFilePaths: changedFilePathsByTurnId.get(turn.id) ?? [],
          isThinkingDuplicate,
          moveFinalThinkingIntoWork,
          planExecutionGate,
        };
        const buildRow = (
          rowMessage: ChatMessageUi,
          part: ChatTurnRowPart,
        ): ReactElement => (
          <ChatMessageRow
            key={chatTurnRowKey(message.id, part)}
            {...buildChatTurnRowProps(rowContext, rowMessage, part)}
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
        const contain = (rowMessage: ChatMessageUi, part: 'whole' | 'prose' | 'work') => (
          <RenderErrorBoundary
            key={part === 'prose' ? `${message.id}:prose` : message.id}
            locale={props.locale ?? 'zh-CN'}
            surface="message"
            resetKey={`${message.id}:${part}:${rowMessage.status}:${rowMessage.text.length}`}
          >
            {buildRow(rowMessage, part)}
          </RenderErrorBoundary>
        );
        const segmentSlot =
          segment !== undefined ? segmentPlan?.slots.get(segment.id) : undefined;
        if (segmentSlot !== undefined && isSegmentNarration) {
          segmentSlot.prose.push(contain(narrationOnlyMessage(effectiveMessage), 'prose'));
          if (segment !== undefined && segmentPlan?.isOpen(segment) === true) {
            segmentSlot.rows.push(contain(withoutNarration(effectiveMessage), 'work'));
          }
          return;
        }
        const containedRow = contain(effectiveMessage, 'whole');
        const rows = finalThinkingRow
          ? [finalThinkingRow, containedRow]
          : [containedRow];
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
          liveActionsFor: (segment) => resolveSegmentLiveActions(turn, segment),
          turnFoldEndId: `turn:${workDisclosureKey}`,
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

      if (input.workflowActivity) renderedAssistantItems.push(
        <Fragment key={`workflow-${turn.id}`}>{input.workflowActivity}</Fragment>,
      );

      // One live line at the foot of the running turn. A permission gate
      // owns the foot while it is up, and so does a compaction that is
      // still running; a settled one must not keep the footer hidden.
      const showRunStatusFooter =
        currentTurnStreaming &&
        !input.workflowActive &&
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
            currentTurnStreaming ? (props.permissionPrompt ? 'waiting' : 'running') : input.workflowActive ? 'running' : null
          }
          editingMessageId={props.editingMessageId}
          locale={props.locale}
          isConversationSession={conversationSession}
          model={turnModel}
          backendAgentId={props.composerCard.activeAgentId}
          contextUsage={props.contextUsage}
        />
      );
}
