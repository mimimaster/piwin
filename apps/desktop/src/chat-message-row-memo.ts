import type { ChatMessageRowProps } from './chat-message-row-types.js';
import type { RunRecordUi } from './chat-ui-types.js';
import { exploreFlowRolesEqual } from './explore-flow.js';

function areFilePathListsEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((path, index) => path === right[index]);
}

/**
 * `phaseHistory` only ever grows by appending, so length plus payload of the
 * last entry describes every change a row can render.
 */
function arePhaseHistoriesEqual(
  left: RunRecordUi['phaseHistory'],
  right: RunRecordUi['phaseHistory'],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  const leftTail = left[left.length - 1];
  const rightTail = right[right.length - 1];
  if (leftTail === rightTail) {
    return true;
  }
  if (leftTail === undefined || rightTail === undefined) {
    return false;
  }
  return (
    leftTail.phase === rightTail.phase &&
    leftTail.at === rightTail.at &&
    leftTail.detail === rightTail.detail
  );
}

/**
 * Field-level Run comparison.
 *
 * `applyRunRecord` rebuilds the whole record on every `run/updated`, so one run
 * advancing a phase hands a new object to every assistant row sharing its
 * runId — while a settled step row renders byte-identical output. Compare what
 * a row reads instead: terminal fields for all rows, live phase chrome only for
 * the turn's last assistant, the one row handed a non-null `activeRunId`.
 */
function areRunRecordsEqual(
  previous: RunRecordUi | undefined,
  next: RunRecordUi | undefined,
  includeLivePhase: boolean,
): boolean {
  if (previous === next) {
    return true;
  }
  if (previous === undefined || next === undefined) {
    return false;
  }
  if (
    previous.outcome !== next.outcome ||
    previous.terminalMessage !== next.terminalMessage ||
    previous.agentStopReason !== next.agentStopReason ||
    // `mergeIdleLoop` returns the stored notice unchanged when nothing moved.
    previous.idleLoop !== next.idleLoop
  ) {
    return false;
  }
  if (!includeLivePhase) {
    return true;
  }
  return (
    previous.status === next.status &&
    previous.phase === next.phase &&
    previous.phaseDetail === next.phaseDetail &&
    previous.startedAt === next.startedAt &&
    previous.endedAt === next.endedAt &&
    arePhaseHistoriesEqual(previous.phaseHistory, next.phaseHistory)
  );
}

export function areChatMessageRowPropsEqual(
  previous: ChatMessageRowProps,
  next: ChatMessageRowProps,
): boolean {
  const isActionableUserMessage = previous.message.role === 'user';
  // composerCard only mounts for the row being edited; ignore identity churn elsewhere.
  const isEditingThisRow =
    previous.editingMessageId === previous.message.id || next.editingMessageId === next.message.id;
  const callbackPropsAreStable =
    previous.onFeedback === next.onFeedback &&
    (isActionableUserMessage
      ? previous.onEdit === next.onEdit &&
        previous.onCancelEdit === next.onCancelEdit &&
        previous.onEditResend === next.onEditResend &&
        previous.onRetry === next.onRetry &&
        previous.onRetryTurn === next.onRetryTurn &&
        previous.onBranchResend === next.onBranchResend &&
        previous.onSwitchBranch === next.onSwitchBranch &&
        previous.branchPoints === next.branchPoints &&
        previous.onInterventionEdit === next.onInterventionEdit &&
        previous.onInterventionCancel === next.onInterventionCancel &&
        (!isEditingThisRow || previous.composerCard === next.composerCard)
      : previous.message.subagentActivity
        ? previous.onInspectSubagent === next.onInspectSubagent
        : true);
  // Global streaming only disables actions on user rows and the turn's last
  // assistant. Historical assistants should not re-render on every send.
  const rowUsesStreamingFlag =
    previous.message.role === 'user' ||
    next.message.role === 'user' ||
    previous.isLastAssistantInTurn === true ||
    next.isLastAssistantInTurn === true;
  const streamingIsStable = !rowUsesStreamingFlag || previous.streaming === next.streaming;
  return (
    previous.message === next.message &&
    previous.sessionId === next.sessionId &&
    previous.messageIndex === next.messageIndex &&
    previous.showStreamingCaret === next.showStreamingCaret &&
    streamingIsStable &&
    previous.activeSessionId === next.activeSessionId &&
    previous.editingMessageId === next.editingMessageId &&
    previous.lastUserMessageId === next.lastUserMessageId &&
    previous.turnUserMessageId === next.turnUserMessageId &&
    previous.activeTheme === next.activeTheme &&
    areFilePathListsEqual(previous.knownFilePaths, next.knownFilePaths) &&
    previous.artifactThemeKey === next.artifactThemeKey &&
    areRunRecordsEqual(
      previous.runRecord,
      next.runRecord,
      previous.isLastAssistantInTurn === true || next.isLastAssistantInTurn === true,
    ) &&
    previous.activeRunId === next.activeRunId &&
    previous.permissionPrompt === next.permissionPrompt &&
    previous.workDetailsExpanded === next.workDetailsExpanded &&
    previous.toolDensity === next.toolDensity &&
    previous.showThinking === next.showThinking &&
    exploreFlowRolesEqual(previous.exploreRole, next.exploreRole) &&
    previous.projectPath === next.projectPath &&
    previous.toolDiffRequest === next.toolDiffRequest &&
    previous.locale === next.locale &&
    previous.onArtifactAction === next.onArtifactAction &&
    previous.onOpenArtifactCanvas === next.onOpenArtifactCanvas &&
    previous.onOpenDocument === next.onOpenDocument &&
    previous.onOpenFile === next.onOpenFile &&
    previous.onOpenDiff === next.onOpenDiff &&
    previous.subagentChildren === next.subagentChildren &&
    previous.subagentInvocations === next.subagentInvocations &&
    previous.subagentStreams === next.subagentStreams &&
    previous.filesChangedRequest === next.filesChangedRequest &&
    previous.onReviewChanges === next.onReviewChanges &&
    previous.walkthroughsByMessageId === next.walkthroughsByMessageId &&
    previous.walkthroughEnabled === next.walkthroughEnabled &&
    previous.walkthroughAutoGenerate === next.walkthroughAutoGenerate &&
    previous.walkthroughEligible === next.walkthroughEligible &&
    previous.onGenerateWalkthrough === next.onGenerateWalkthrough &&
    previous.onCancelWalkthrough === next.onCancelWalkthrough &&
    previous.onForkFromMessage === next.onForkFromMessage &&
    previous.onOpenForks === next.onOpenForks &&
    previous.forkCountsByMessageId === next.forkCountsByMessageId &&
    previous.sessionLineage === next.sessionLineage &&
    previous.onOpenSession === next.onOpenSession &&
    previous.derivedActionsDisabled === next.derivedActionsDisabled &&
    previous.isLastAssistantInTurn === next.isLastAssistantInTurn &&
    previous.turnInProgress === next.turnInProgress &&
    previous.turnFlashcardTools === next.turnFlashcardTools &&
    previous.turnTools === next.turnTools &&
    previous.turnRunKey === next.turnRunKey &&
    previous.isLatestAssistantResponse === next.isLatestAssistantResponse &&
    previous.assemblySummary === next.assemblySummary &&
    previous.isConversationSession === next.isConversationSession &&
    previous.showConversationHeader === next.showConversationHeader &&
    previous.showConversationTurnUsage === next.showConversationTurnUsage &&
    previous.onResolveFlashcards === next.onResolveFlashcards &&
    previous.onRegenerate === next.onRegenerate &&
    previous.onRetryTurn === next.onRetryTurn &&
    previous.onContinueTurn === next.onContinueTurn &&
    previous.livePromptModel === next.livePromptModel &&
    previous.contextUsage === next.contextUsage &&
    previous.modelOptions === next.modelOptions &&
    previous.configProviders === next.configProviders &&
    previous.planExecutionGate === next.planExecutionGate &&
    callbackPropsAreStable
  );
}
