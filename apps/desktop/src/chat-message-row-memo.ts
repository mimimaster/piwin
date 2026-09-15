import type { ChatMessageRowProps } from './chat-message-row-types.js';
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
    previous.runRecord === next.runRecord &&
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
    previous.turnFlashcardTools === next.turnFlashcardTools &&
    previous.turnTools === next.turnTools &&
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
