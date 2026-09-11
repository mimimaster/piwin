/**
 * Single chat message row wrapper (Agent vs Conversation, user vs assistant vs system).
 */
import { memo, useMemo, type ReactElement } from 'react';
import { pickArtifactFenceSecurity } from './artifact-fence-security';
import { isAssistantContentEmpty } from './assistant-message-content';
import { MarkdownView } from './MarkdownView';
import { CitationCards } from './CitationCards';
import { MessageAttachments } from './message-attachments';
import { findActiveBranchPoint } from './conversation-branch.js';
import { MessageBranchSwitcher } from './message-branch-switcher.js';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { SubagentActivitySlot } from './subagent-activity-card';
import { TurnWorkDetails } from './turn-work-details';
import { AssemblySummaryCapsule } from './assembly-summary-capsule';
import { WalkthroughAction } from './walkthrough-action';
import { ChatTurnFilesSummary } from './chat-turn-files-summary';
import { ImageGenerationProgress } from './image-generation-progress';
import { VideoGenerationProgress } from './video-generation-progress';
import {
  getGenerationStatus,
  getGenerationTool,
  shouldRenderGenerationProgress,
} from './generation-tool-kind.js';
import { ConversationResponseContent } from './conversation-response-content.js';
import { extractFlashcardRecords } from './flashcard-result-extract.js';
import { FlashcardResultProjection } from './FlashcardResultProjection.js';
import { collectKnowledgeCitations } from './knowledge/knowledge-citation-collect.js';
import { citationsForRefs, citedKnowledgeRefs } from './knowledge/knowledge-citations.js';
import { KnowledgeCitationSources } from './knowledge/KnowledgeCitationSources.js';
import { AssistantResponseActions } from './assistant-response-actions';
import { buildAssistantColophonMeta } from './chat-turn-marginalia';
import { buildConversationTurnUsageChip } from './conversation-message-header';
import { shouldHideConversationAssistantRow } from './conversation-turn-chrome';

import { UserMessageContent } from './conversation-user-message';
import { SystemMessageContent } from './system-message-content';
import { resolveAssistantRenderingPhase } from './streaming-caret';
import { useDesktopContextMenu, type ContextMenuTarget } from './context-menu';
import { MessageEditCard } from './chat-message-edit-card';
import { TurnErrorCard } from './turn-error-card';
import { TurnTruncationCard } from './turn-truncation-card';
import { MessageBubbleContextMenu } from './message-bubble-context-menu';
import { resolveTurnErrorMessage } from './turn-error-presentation';
import { turnAttemptHasRetainedWork } from './turn-attempt-work';

export type { ChatMessageRowProps } from './chat-message-row-types.js';
import type { ChatMessageRowProps } from './chat-message-row-types.js';
import { areChatMessageRowPropsEqual } from './chat-message-row-memo.js';

export const ChatMessageRow = memo(
  function ChatMessageRow(props: ChatMessageRowProps): ReactElement | null {
    const { message } = props;
    const errorMessage = resolveTurnErrorMessage({
      messageStatus: message.status,
      messageError: message.error,
      runOutcome: props.runRecord?.outcome,
      runTerminalMessage: props.runRecord?.terminalMessage,
      isLastAssistantInTurn: props.isLastAssistantInTurn === true,
      locale: props.locale,
    });
    const imageGenerationStatus =
      message.role === 'assistant' ? getGenerationStatus(message, 'image') : null;
    const videoGenerationStatus =
      message.role === 'assistant' ? getGenerationStatus(message, 'video') : null;
    const imageGenerationTool =
      message.role === 'assistant' ? getGenerationTool(message, 'image') : null;
    const videoGenerationTool =
      message.role === 'assistant' ? getGenerationTool(message, 'video') : null;
    const contextMenu = useDesktopContextMenu();
    const knowledgeCitations = useMemo(() => collectKnowledgeCitations(message), [message]);
    const citedKnowledgeSources = useMemo(
      () =>
        citationsForRefs(knowledgeCitations, citedKnowledgeRefs(message.text, knowledgeCitations)),
      [knowledgeCitations, message.text],
    );
    if (message.subagentActivity) {
      if (props.isConversationSession === true) {
        return null;
      }
      return (
        <div id={`msg-${message.id}`} className="chat-subagent-slot">
          <SubagentActivitySlot
            activity={message.subagentActivity}
            {...(props.onInspectSubagent ? { onInspect: props.onInspectSubagent } : {})}
          />
        </div>
      );
    }

    const isEditingThis = props.editingMessageId === message.id;
    // Conversation projects one assistant reply per user turn. Intermediate
    // thinking/tool completions stay in the transcript but do not get a row.
    // Agent mode still keeps every lifecycle segment in document order.
    if (
      props.isConversationSession === true &&
      shouldHideConversationAssistantRow({
        message,
        isLastAssistantInTurn: props.isLastAssistantInTurn === true,
        isActivelyStreaming: props.streaming === true && message.status === 'streaming',
      })
    ) {
      return null;
    }
    // Keep errored turns visible even when the provider failed before any
    // content: an empty bubble is still the only place TurnErrorCard renders.
    if (
      message.status !== 'streaming' &&
      message.status !== 'error' &&
      !message.error &&
      props.runRecord?.outcome !== 'failed' &&
      isAssistantContentEmpty(message) &&
      imageGenerationStatus === null &&
      videoGenerationStatus === null
    ) {
      return null;
    }
    // Explore-flow members render inside the anchor's capsule. Skip the empty
    // bubble unless this row still owns other chrome (permission gate, failed
    // run diagnostics, or the action row of a completed turn).
    if (
      props.exploreRole?.kind === 'member' &&
      message.role === 'assistant' &&
      message.text.trim().length === 0 &&
      message.attachments.length === 0 &&
      !message.error &&
      message.status !== 'error' &&
      (message.searchEvidence?.citations.length ?? 0) === 0 &&
      imageGenerationStatus === null &&
      videoGenerationStatus === null &&
      props.runRecord?.outcome !== 'failed' &&
      !(props.isLastAssistantInTurn === true && props.permissionPrompt) &&
      !(props.isLastAssistantInTurn === true && !props.streaming)
    ) {
      return null;
    }

    const isUserMessage = message.role === 'user';
    const rowClass = [
      'bubble',
      'chat-message-row',
      `role-${message.role}`,
      props.isConversationSession === true &&
      isUserMessage &&
      message.source !== 'voice-delegation'
        ? 'is-conversation-bubble'
        : '',
      message.source === 'voice-delegation' ? 'is-voice-handover' : '',
      props.isConversationSession === true &&
      message.role === 'assistant' &&
      props.showConversationHeader === false
        ? 'is-turn-continuation'
        : '',
      message.role === 'assistant' &&
      message.text.trim().length === 0 &&
      message.tools.length > 0
        ? 'is-tool-only'
        : '',
      message.status === 'streaming' ? 'is-streaming' : '',
      props.isNew ? 'is-new' : '',
      isEditingThis ? 'is-editing' : '',
    ]
      .filter(Boolean)
      .join(' ');
    // Double-click any user bubble (or click the pencil action) to enter edit
    // mode in-place. Editing the last user message sends immediately; editing
    // an earlier message triggers the revert confirmation in App.
    const canEditPendingIntervention = message.instructionDelivery?.status === 'pending';
    const handleDoubleClick =
      isUserMessage && !isEditingThis && (!props.streaming || canEditPendingIntervention)
        ? () => props.onEdit(message.id)
        : undefined;

    // CM-10: message surface target. Capabilities follow existing session
    // action rules: retry on user bubbles; fork on completed assistants when a
    // fork hook exists; side chat when the host has a session.
    const messageTarget: ContextMenuTarget | null =
      contextMenu &&
      props.activeSessionId &&
      (message.role === 'user' || message.role === 'assistant')
        ? {
            surface: message.role === 'user' ? 'message-user' : 'message-assistant',
            sessionId: props.activeSessionId,
            messageId: message.id,
            text: message.text,
            label: message.role === 'user' ? 'User message' : 'Assistant response',
            capabilities: {
              canRetry: isUserMessage && !props.streaming,
              canFork:
                message.role === 'assistant' &&
                message.status === 'done' &&
                props.onForkFromMessage !== undefined &&
                !props.streaming,
              canSideChat: Boolean(props.activeSessionId && !props.streaming),
            },
          }
        : null;

    const bubble = (
      <article
        id={`msg-${message.id}`}
        className={rowClass}
        data-testid="message-bubble"
        data-role={message.role}
        {...(handleDoubleClick ? { onDoubleClick: handleDoubleClick } : {})}
      >
        {message.role === 'assistant' ? (
          props.isConversationSession === true ? (
            <ConversationResponseContent
              message={message}
              renderExtractedFlashcards={
                props.isConversationSession !== true ||
                props.isLastAssistantInTurn === true ||
                !props.turnFlashcardTools ||
                props.turnFlashcardTools.length === 0
              }
              {...(props.isLastAssistantInTurn === true &&
              props.turnFlashcardTools &&
              props.turnFlashcardTools.length > 0
                ? { sourceTools: props.turnFlashcardTools }
                : {})}
              {...(props.onResolveFlashcards
                ? { onResolveFlashcards: props.onResolveFlashcards }
                : {})}
              {...(props.sessionId ? { sessionId: props.sessionId } : {})}
              messageIndex={props.messageIndex}
              showStreamingCaret={props.showStreamingCaret}
              activeTheme={props.activeTheme}
              artifactThemeKey={props.artifactThemeKey}
              {...(props.artifactCodeFirst !== undefined
                ? { artifactCodeFirst: props.artifactCodeFirst }
                : {})}
              runRecordsById={props.runRecordsById}
              activeRunId={props.activeRunId}
              locale={props.locale ?? 'zh-CN'}
              {...(props.livePromptModel !== undefined
                ? { livePromptModel: props.livePromptModel }
                : {})}
              {...(props.isLatestAssistantResponse !== undefined
                ? { isLatestAssistantResponse: props.isLatestAssistantResponse }
                : {})}
              {...(props.modelOptions !== undefined ? { modelOptions: props.modelOptions } : {})}
              {...(props.configProviders !== undefined
                ? { configProviders: props.configProviders }
                : {})}
              showHeader={props.showConversationHeader !== false}
              usageChip={
                props.isConversationSession === true &&
                props.showConversationHeader !== false &&
                props.showConversationTurnUsage === true
                  ? buildConversationTurnUsageChip(props.contextUsage, props.locale ?? 'zh-CN')
                  : null
              }
              // Explicit `false` must not wipe message-local streaming: `??`
              // only falls through for null/undefined, so a global streaming
              // clear used to drop livePromptModel and hide the provider avatar.
              isStreaming={props.streaming === true && message.status === 'streaming'}
              artifactPreviewEnabled={props.artifactPreviewEnabled}
              {...pickArtifactFenceSecurity(props)}
              {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
              {...(props.onOpenArtifactCanvas
                ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                : {})}
              {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
              {...(props.projectPath ? { projectPath: props.projectPath } : {})}
              toolDensity={props.toolDensity}
              {...(props.toolDiffRequest !== undefined
                ? { toolDiffRequest: props.toolDiffRequest }
                : {})}
              {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
              {...(props.onOpenDiff ? { onOpenDiff: props.onOpenDiff } : {})}
              {...(props.exploreRole !== undefined ? { exploreRole: props.exploreRole } : {})}
              {...(props.showThinking !== undefined ? { showThinking: props.showThinking } : {})}
            />
          ) : (
            <TurnWorkDetails
              message={message}
              runRecordsById={props.runRecordsById}
              activeRunId={props.isLastAssistantInTurn === true ? props.activeRunId : null}
              activeSkill={props.isLastAssistantInTurn === true ? props.activeSkill : null}
              {...(props.agentLocatorAnimation
                ? { agentLocatorAnimation: props.agentLocatorAnimation }
                : {})}
              permissionPrompt={
                props.isLastAssistantInTurn === true ? props.permissionPrompt : null
              }
              {...(props.onPermission !== undefined ? { onPermission: props.onPermission } : {})}
              workDetailsExpanded={props.workDetailsExpanded}
              toolDensity={props.toolDensity}
              showThinking={props.showThinking}
              {...(props.exploreRole !== undefined ? { exploreRole: props.exploreRole } : {})}
              {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
              {...(props.toolDiffRequest !== undefined ? { request: props.toolDiffRequest } : {})}
              {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
              {...(props.onOpenDiff ? { onOpenDiff: props.onOpenDiff } : {})}
              {...(props.onOpenDocument
                ? {
                    onOpenDocument: (input) =>
                      props.onOpenDocument?.({
                        ...input,
                        messageId: input.messageId ?? message.id,
                      }),
                  }
                : {})}
              {...(props.subagentChildren ? { subagentChildren: props.subagentChildren } : {})}
              {...(props.subagentInvocations
                ? { subagentInvocations: props.subagentInvocations }
                : {})}
              {...(props.subagentStreams ? { subagentStreams: props.subagentStreams } : {})}
              {...(props.onInspectSubagent ? { onInspectSubagent: props.onInspectSubagent } : {})}
              {...(props.locale ? { locale: props.locale } : {})}
              {...(props.modelOptions ? { modelOptions: props.modelOptions } : {})}
              {...(props.planExecutionGate
                ? { planExecutionGate: props.planExecutionGate }
                : {})}
            >
              {message.text.trim().length > 0 ? (
                <MarkdownView
                  text={message.text}
                  renderingPhase={resolveAssistantRenderingPhase(
                    message,
                    props.runRecordsById,
                    props.activeRunId,
                  )}
                  artifactTheme={mapThemeToArtifactVariables(props.activeTheme)}
                  initPriorityBase={props.messageIndex * 10}
                  artifactThemeKey={`${props.activeTheme?.id ?? 'none'}:${props.artifactThemeKey}`}
                  showStreamingCaret={props.showStreamingCaret}
                  locale={props.locale ?? 'zh-CN'}
                  artifactPreviewEnabled={props.artifactPreviewEnabled}
                  artifactCodeFirst={props.artifactCodeFirst ?? false}
                  {...pickArtifactFenceSecurity(props)}
                  {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
                  {...(props.sessionId
                    ? { artifactOrigin: { sessionId: props.sessionId, messageId: message.id } }
                    : {})}
                  {...(props.onOpenArtifactCanvas
                    ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                    : {})}
                  {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
                  {...(props.projectPath ? { projectPath: props.projectPath } : {})}
                  knowledgeCitations={knowledgeCitations}
                />
              ) : null}
              {message.searchEvidence !== undefined ? (
                <CitationCards evidence={message.searchEvidence} />
              ) : null}
              <KnowledgeCitationSources
                citations={citedKnowledgeSources}
                locale={props.locale ?? 'zh-CN'}
              />
              <FlashcardResultProjection
                cards={extractFlashcardRecords(message)}
                locale={props.locale ?? 'zh-CN'}
                {...(props.onArtifactAction ? { onAction: props.onArtifactAction } : {})}
              />
            </TurnWorkDetails>
          )
        ) : null}
        {imageGenerationStatus &&
        shouldRenderGenerationProgress(imageGenerationStatus, message.attachments) ? (
          <ImageGenerationProgress
            locale={props.locale ?? 'zh-CN'}
            status={imageGenerationStatus}
            {...(imageGenerationTool ? { tool: imageGenerationTool } : {})}
          />
        ) : null}
        {videoGenerationStatus &&
        shouldRenderGenerationProgress(videoGenerationStatus, message.attachments) ? (
          <VideoGenerationProgress
            locale={props.locale ?? 'zh-CN'}
            status={videoGenerationStatus}
            {...(videoGenerationTool ? { tool: videoGenerationTool } : {})}
          />
        ) : null}
        {message.role === 'assistant' || isEditingThis ? (
          <MessageAttachments
            attachments={message.attachments}
            {...(message.contextRefs ? { contextRefs: message.contextRefs } : {})}
            role={message.role}
            {...(props.locale !== undefined ? { locale: props.locale } : {})}
          />
        ) : null}
        {message.role === 'system' ? (
          <SystemMessageContent
            text={message.text}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
            {...(props.knownFilePaths ? { knownFilePaths: props.knownFilePaths } : {})}
          />
        ) : isEditingThis ? (
          <MessageEditCard
            messageId={message.id}
            initialText={message.text}
            composerCard={props.composerCard}
            {...(message.attachments.length > 0 ||
            (message.contextRefs !== undefined && message.contextRefs.length > 0)
              ? { hasCarryContent: true }
              : {})}
            onCancel={props.onCancelEdit}
            onResend={(text) => {
              if (canEditPendingIntervention && props.onInterventionEdit) {
                void props.onInterventionEdit(message.id, text);
                return;
              }
              props.onEditResend(message.id, text);
            }}
            {...(props.onBranchResend
              ? { onOpenBranch: (text) => props.onBranchResend?.(message.id, text) }
              : {})}
            interventionEdit={canEditPendingIntervention}
            currentTurn={props.lastUserMessageId === message.id}
            branchPoint={findActiveBranchPoint(props.branchPoints ?? [], message.id)}
            {...(props.locale !== undefined ? { locale: props.locale } : {})}
          />
        ) : message.role === 'assistant' ? null : (
          <UserMessageContent
            message={message}
            streaming={props.streaming}
            onRetry={props.onRetry}
            {...(() => {
              const point = findActiveBranchPoint(props.branchPoints ?? [], message.id);
              if (!point || !props.onSwitchBranch) {
                return {};
              }
              return {
                branchSwitcher: (
                  <MessageBranchSwitcher
                    point={point}
                    disabled={props.streaming === true}
                    onSwitch={props.onSwitchBranch}
                    {...(props.locale !== undefined ? { locale: props.locale } : {})}
                  />
                ),
              };
            })()}
            {...(props.isConversationSession !== undefined
              ? { isConversationSession: props.isConversationSession }
              : {})}
            {...(canEditPendingIntervention && props.onInterventionEdit
              ? { onInterventionEdit: props.onEdit }
              : {})}
            {...(props.onInterventionCancel
              ? { onInterventionCancel: props.onInterventionCancel }
              : {})}
            onFeedback={props.onFeedback}
            {...(props.locale ? { locale: props.locale } : {})}
          />
        )}
        {props.isLastAssistantInTurn === true ? (
          <ChatTurnFilesSummary
            role={message.role}
            tools={props.turnTools ?? message.tools}
            {...(props.isConversationSession !== undefined
              ? { isConversationSession: props.isConversationSession }
              : {})}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.filesChangedRequest !== undefined ? { request: props.filesChangedRequest } : {})}
            {...(props.onReviewChanges !== undefined ? { onReview: props.onReviewChanges } : {})}
            {...(props.locale ? { locale: props.locale } : {})}
          />
        ) : null}
        {props.isConversationSession !== true &&
        message.role === 'assistant' &&
        props.isLastAssistantInTurn === true &&
        props.onGenerateWalkthrough ? (
          <WalkthroughAction
            message={message}
            artifact={props.walkthroughsByMessageId?.[message.id]}
            eligible={props.walkthroughEligible === true}
            autoGenerate={props.walkthroughAutoGenerate === true}
            onGenerate={props.onGenerateWalkthrough}
            {...(props.locale ? { locale: props.locale } : {})}
            {...(props.onCancelWalkthrough ? { onCancel: props.onCancelWalkthrough } : {})}
            {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
          />
        ) : null}
        {message.role === 'assistant' &&
        props.isLastAssistantInTurn === true &&
        props.runRecord?.outcome === 'completed' &&
        props.runRecord?.agentStopReason === 'length' ? (
          <TurnTruncationCard
            {...(props.locale ? { locale: props.locale } : {})}
            {...(props.onContinueTurn ? { onContinue: props.onContinueTurn } : {})}
          />
        ) : null}
        {message.role === 'assistant' && errorMessage !== null ? (
          <TurnErrorCard
            messageId={message.id}
            error={errorMessage}
            {...(message.failure === undefined ? {} : { failure: message.failure })}
            locale={props.locale}
            {...(() => {
              const retryUserMessageId = props.turnUserMessageId ?? props.lastUserMessageId;
              const restart = (): void => {
                if (retryUserMessageId && props.onRetryTurn) {
                  props.onRetryTurn(retryUserMessageId, { keepPrevious: false });
                } else if (props.onRegenerate) {
                  props.onRegenerate();
                } else if (retryUserMessageId) {
                  props.onRetry(retryUserMessageId);
                }
              };
              const retained = turnAttemptHasRetainedWork({
                text: message.text,
                tools: message.tools,
                attachments: message.attachments,
                ...(props.turnTools ? { turnTools: props.turnTools } : {}),
              });
              if (retained && props.onContinueTurn) {
                return { onContinue: props.onContinueTurn, onRestart: restart };
              }
              return { onRetry: restart };
            })()}
            onFeedback={props.onFeedback}
          />
        ) : null}
        {message.role === 'assistant'
          ? (() => {
              const point = findActiveBranchPoint(props.branchPoints ?? [], message.id);
              if (!point || !props.onSwitchBranch) {
                return null;
              }
              return (
                <MessageBranchSwitcher
                  point={point}
                  disabled={props.streaming === true}
                  onSwitch={props.onSwitchBranch}
                  {...(props.locale !== undefined ? { locale: props.locale } : {})}
                />
              );
            })()
          : null}
        {message.role === 'assistant' &&
        message.status === 'done' &&
        props.isLastAssistantInTurn === true &&
        (props.onForkFromMessage ||
          message.text ||
          (props.isLatestAssistantResponse === true &&
            props.onRegenerate !== undefined)) ? (
          <AssistantResponseActions
            messageId={message.id}
            messageText={message.text}
            colophonMeta={buildAssistantColophonMeta({
              message,
              locale: props.locale ?? 'zh-CN',
              contextUsage:
                props.isLatestAssistantResponse === true ? props.contextUsage : null,
            })}
            showFork={props.isLastAssistantInTurn === true && props.onForkFromMessage !== undefined}
            showRegenerate={
              props.isLatestAssistantResponse === true &&
              props.onRegenerate !== undefined
            }
            {...(props.onRegenerate !== undefined ? { onRegenerate: props.onRegenerate } : {})}
            directForkCount={props.forkCountsByMessageId?.[message.id] ?? 0}
            {...(props.sessionLineage ? { lineage: props.sessionLineage } : {})}
            showTreeOnLatestResponse={props.isLatestAssistantResponse === true}
            disabled={props.derivedActionsDisabled === true || props.streaming}
            {...(props.onForkFromMessage
              ? { onFork: props.onForkFromMessage }
              : { onFork: () => {} })}
            {...(props.onOpenForks ? { onOpenForks: props.onOpenForks } : {})}
            {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
            {...(props.onFeedback ? { onFeedback: props.onFeedback } : {})}
            locale={props.locale ?? 'en'}
          />
        ) : null}
      </article>
    );

    // CM-10: message context menu wraps the whole bubble. Streaming rows keep
    // the menu (retry/fork are capability-gated off); subagent cards are
    // handled by the early return above.
    const showPreparingCapsule =
      isUserMessage &&
      props.assemblySummary === undefined &&
      props.streaming === true &&
      props.activeRunId != null &&
      props.lastUserMessageId === message.id;
    const capsule =
      isUserMessage &&
      (props.assemblySummary !== undefined || showPreparingCapsule) ? (
        <AssemblySummaryCapsule
          {...(props.assemblySummary !== undefined ? { summary: props.assemblySummary } : {})}
          {...(showPreparingCapsule && props.assemblySummary === undefined
            ? { preparing: true }
            : {})}
          locale={props.locale ?? 'zh-CN'}
        />
      ) : null;
    const row = (
      <>
        {bubble}
        {capsule}
      </>
    );
    if (!messageTarget || !contextMenu) {
      return row;
    }
    return (
      <>
        <MessageBubbleContextMenu
          messageTarget={messageTarget}
          caps={contextMenu.caps}
          dispatchers={contextMenu.dispatchers}
        >
          {bubble}
        </MessageBubbleContextMenu>
        {capsule}
      </>
    );
  },
  areChatMessageRowPropsEqual,
);
