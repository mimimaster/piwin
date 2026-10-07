import type {
  ContextSummaryPush,
  TranscriptBranchPoint,
} from '@piwin/contracts';

import { pickArtifactFenceSecurity } from './artifact-fence-security';
import type { ChatMessageUi, ToolCardUi } from './chat-reducer';
import type { ChatMessageRowProps } from './chat-message-row-types.js';
import type { ChatThreadProps } from './chat-thread-types.js';
import type { ConversationTurnChrome } from './conversation-turn-chrome.js';
import type { ExploreFlowRole } from './explore-flow.js';
import { isWalkthroughEligible } from './walkthrough-action';
import type { TranscriptTurn } from './transcript-turns';

/**
 * Stable defaults. A fresh `[]` per render failed the reference check in
 * `areChatMessageRowPropsEqual` for every user row on every push.
 */
export const EMPTY_BRANCH_POINTS: TranscriptBranchPoint[] = [];

export type ChatTurnRowPart = 'whole' | 'prose' | 'work';

export type ChatTurnRowBuildContext = {
  props: ChatThreadProps;
  turn: TranscriptTurn;
  /** The prompt that opened the turn; resolved once per turn, not per row. */
  turnUserMessageId: string | null;
  message: ChatMessageUi;
  messageIndex: number;
  conversationSession: boolean;
  conversationChrome: ConversationTurnChrome | null;
  identityLiftedAboveWorkDisclosure: boolean;
  exploreRole: ExploreFlowRole | undefined;
  assemblySummary: ContextSummaryPush | undefined;
  streamingCaretMessageId: string | null;
  currentTurnStreaming: boolean;
  rowNeedsTurnTools: boolean;
  isLastAssistantRow: boolean;
  turnTools: readonly ToolCardUi[];
  turnRunKey: string;
  turnFlashcardTools: readonly ToolCardUi[];
  isLatestAssistant: boolean;
  onRegenerate: (() => void) | undefined;
  enteringIds: ReadonlySet<string>;
  changedFilePaths: readonly string[];
  isThinkingDuplicate: boolean;
  moveFinalThinkingIntoWork: boolean;
  planExecutionGate: ChatMessageRowProps['planExecutionGate'];
};

/**
 * Build ChatMessageRow props for one turn item part.
 * Pure: inputs are thread props + per-item turn context; returns the row props.
 * Callers wrap with `<ChatMessageRow key={...} {...props} />`.
 */
export function buildChatTurnRowProps(
  context: ChatTurnRowBuildContext,
  rowMessage: ChatMessageUi,
  part: ChatTurnRowPart,
): ChatMessageRowProps {
  const {
    props,
    turn,
    turnUserMessageId,
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
    changedFilePaths,
    isThinkingDuplicate,
    moveFinalThinkingIntoWork,
    planExecutionGate,
  } = context;

  return {
    message: rowMessage,
    ...(part === 'work' ? { omitAnchorId: true } : {}),
    ...(exploreRole !== undefined && part !== 'prose' ? { exploreRole } : {}),
    isConversationSession: conversationSession,
    ...(conversationChrome
      ? {
          showConversationHeader:
            conversationChrome.identityMessageId === message.id &&
            !identityLiftedAboveWorkDisclosure,
          showConversationTurnUsage:
            conversationChrome.showUsageOnIdentity &&
            !identityLiftedAboveWorkDisclosure,
        }
      : {}),
    ...(props.onResolveFlashcards
      ? { onResolveFlashcards: props.onResolveFlashcards }
      : {}),
    ...(assemblySummary !== undefined ? { assemblySummary } : {}),
    ...(props.sessionId ? { sessionId: props.sessionId } : {}),
    messageIndex,
    showStreamingCaret: part !== 'work' && streamingCaretMessageId === message.id,
    isLastAssistantInTurn: part !== 'prose' && turn.lastAssistantMessageId === message.id,
    turnInProgress: currentTurnStreaming,
    ...(rowNeedsTurnTools && part !== 'prose' ? { turnTools } : {}),
    ...(isLastAssistantRow && part !== 'prose' && turnRunKey ? { turnRunKey } : {}),
    ...(isLastAssistantRow && part !== 'prose' && turnFlashcardTools.length > 0
      ? { turnFlashcardTools }
      : {}),
    isLatestAssistantResponse: isLatestAssistant && part !== 'prose',
    ...(props.livePromptModel !== undefined
      ? { livePromptModel: props.livePromptModel }
      : {}),
    ...(props.modelOptions !== undefined ? { modelOptions: props.modelOptions } : {}),
    ...(props.configProviders !== undefined
      ? { configProviders: props.configProviders }
      : {}),
    ...(isLatestAssistant && props.contextUsage !== undefined
      ? { contextUsage: props.contextUsage }
      : {}),
    ...(planExecutionGate ? { planExecutionGate } : {}),
    ...(onRegenerate !== undefined ? { onRegenerate } : {}),
    isNew: enteringIds.has(message.id),
    knownFilePaths: changedFilePaths,
    streaming: props.streaming,
    activeSessionId: props.activeSessionId ?? null,
    editingMessageId: props.editingMessageId,
    lastUserMessageId: props.lastUserMessageId,
    ...(turnUserMessageId !== null ? { turnUserMessageId } : {}),
    activeTheme: props.activeTheme,
    artifactThemeKey: props.artifactThemeKey,
    runRecordsById: props.runRecordsById ?? {},
    ...(message.runId !== undefined && props.runRecordsById?.[message.runId] !== undefined
      ? { runRecord: props.runRecordsById[message.runId] }
      : {}),
    activeRunId: props.activeRunId ?? null,
    permissionPrompt: props.permissionPrompt ?? null,
    ...(props.onPermission !== undefined ? { onPermission: props.onPermission } : {}),
    workDetailsExpanded: props.workDetailsExpanded ?? 'auto',
    toolDensity: props.toolDensity ?? 'comfortable',
    showThinking:
      isThinkingDuplicate || moveFinalThinkingIntoWork
        ? false
        : props.showThinking !== false,
    ...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {}),
    ...(props.toolDiffRequest !== undefined
      ? { toolDiffRequest: props.toolDiffRequest }
      : {}),
    ...(props.filesChangedRequest !== undefined
      ? { filesChangedRequest: props.filesChangedRequest }
      : {}),
    ...(props.onReviewChanges !== undefined
      ? { onReviewChanges: props.onReviewChanges }
      : {}),
    onEdit: props.onEdit,
    onCancelEdit: props.onCancelEdit,
    onEditResend: props.onEditResend,
    onRetry: props.onRetry,
    ...(props.onBranchResend !== undefined ? { onBranchResend: props.onBranchResend } : {}),
    ...(props.onRetryTurn !== undefined ? { onRetryTurn: props.onRetryTurn } : {}),
    ...(props.onContinueTurn !== undefined ? { onContinueTurn: props.onContinueTurn } : {}),
    branchPoints: props.branchPoints ?? EMPTY_BRANCH_POINTS,
    ...(props.onSwitchBranch !== undefined ? { onSwitchBranch: props.onSwitchBranch } : {}),
    ...(props.onInterventionEdit
      ? { onInterventionEdit: props.onInterventionEdit }
      : {}),
    ...(props.onInterventionCancel
      ? { onInterventionCancel: props.onInterventionCancel }
      : {}),
    onFeedback: props.onFeedback,
    onInspectSubagent: props.onInspectSubagent,
    ...(props.docCardRequest ? { docCardRequest: props.docCardRequest } : {}),
    ...(props.subagentChildren ? { subagentChildren: props.subagentChildren } : {}),
    ...(props.subagentInvocations
      ? { subagentInvocations: props.subagentInvocations }
      : {}),
    ...(props.subagentStreams ? { subagentStreams: props.subagentStreams } : {}),
    composerCard: props.composerCard,
    ...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {}),
    ...(props.onOpenArtifactCanvas
      ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
      : {}),
    artifactInlineEnabled: props.artifactInlineEnabled,
    artifactCanvasEnabled: props.artifactCanvasEnabled ?? props.artifactInlineEnabled,
    ...(props.artifactCodeFirst !== undefined
      ? { artifactCodeFirst: props.artifactCodeFirst }
      : {}),
    ...pickArtifactFenceSecurity(props),
    ...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {}),
    ...(props.onOpenDiff ? { onOpenDiff: props.onOpenDiff } : {}),
    ...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {}),
    ...(props.locale ? { locale: props.locale } : {}),
    ...(props.walkthroughsByMessageId
      ? { walkthroughsByMessageId: props.walkthroughsByMessageId }
      : {}),
    ...(props.walkthroughEnabled !== undefined
      ? { walkthroughEnabled: props.walkthroughEnabled }
      : {}),
    ...(props.walkthroughAutoGenerate !== undefined
      ? { walkthroughAutoGenerate: props.walkthroughAutoGenerate }
      : {}),
    ...(props.onGenerateWalkthrough
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
      : {}),
    ...(props.onCancelWalkthrough
      ? { onCancelWalkthrough: props.onCancelWalkthrough }
      : {}),
    ...(props.onForkFromMessage ? { onForkFromMessage: props.onForkFromMessage } : {}),
    ...(props.onOpenForks ? { onOpenForks: props.onOpenForks } : {}),
    ...(props.forkCountsByMessageId
      ? { forkCountsByMessageId: props.forkCountsByMessageId }
      : {}),
    ...(props.sessionLineage ? { sessionLineage: props.sessionLineage } : {}),
    ...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {}),
    ...(props.derivedActionsDisabled !== undefined
      ? { derivedActionsDisabled: props.derivedActionsDisabled }
      : {}),
  };
}

/** Row React key — prose splits share the message id with a suffix. */
export function chatTurnRowKey(messageId: string, part: ChatTurnRowPart): string {
  return part === 'prose' ? `${messageId}:prose` : messageId;
}
