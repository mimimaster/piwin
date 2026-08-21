/**
 * Single chat message row wrapper (Agent vs Conversation, user vs assistant vs system).
 */
import { memo, type ReactElement } from 'react';
import type {
  ContextSummaryPush,
  ContextUsageSnapshot,
  ModelProviderConfig,
  ModelRef,
  ProductSessionLineageView,
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
  SubagentStreamState,
  ToolCardUi,
} from './chat-reducer';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import { exploreFlowRolesEqual, type ExploreFlowRole } from './explore-flow';
import { MarkdownView } from './MarkdownView';
import { CitationCards } from './CitationCards';
import { MessageAttachments } from './message-attachments';
import { findActiveBranchPoint } from './conversation-branch.js';
import { MessageBranchSwitcher } from './message-branch-switcher.js';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { SubagentActivitySlot } from './subagent-activity-card';
import { TurnWorkDetails } from './turn-work-details';
import type { DocumentOpenInput } from './tool-call-card';
import { AssemblySummaryCapsule } from './assembly-summary-capsule';
import { WalkthroughAction } from './walkthrough-action';
import { FilesChangedBar, type FilesChangedBarRequest } from './files-changed-bar';
import { ImageGenerationProgress } from './image-generation-progress';
import { VideoGenerationProgress } from './video-generation-progress';
import {
  resolveGenerationToolKind,
  shouldRenderGenerationProgress,
  type GenerationToolKind,
} from './generation-tool-kind.js';
import {
  ConversationResponseContent,
  extractFlashcardRecords,
  extractFlashcardArtifactHtml,
} from './conversation-response-content.js';
import { isFlashcardArtifactSource } from './flashcard-artifact.js';
import { FlashcardStackView } from './FlashcardView.js';
import type { AgentLocatorAnimation, ToolCallDensity, WorkDetailsExpanded } from './ui-preferences';
import type { ComposerDockProps } from './composer-dock';
import type { DiffCardRequest } from './diff-card';
import { AssistantResponseActions } from './assistant-response-actions';
import { buildConversationTurnUsageChip } from './conversation-message-header';
import { shouldHideConversationAssistantRow } from './conversation-turn-chrome';
import { UserMessageContent } from './conversation-user-message';
import type { ModelOption } from './model-options';
import { SystemMessageContent } from './system-message-content';
import { resolveAssistantRenderingPhase } from './streaming-caret';
import { useDesktopContextMenu, type ContextMenuTarget } from './context-menu';
import type { DocCardSequenceRequest } from './DocCardSequenceView';
import { MessageEditCard } from './chat-message-edit-card';
import { TurnErrorCard } from './turn-error-card';
import { MessageBubbleContextMenu } from './message-bubble-context-menu';

export type ChatMessageRowProps = {
  message: ChatMessageUi;
  sessionId?: string;
  messageIndex: number;
  showStreamingCaret: boolean;
  /** Quiet workbench: entrance animation for messages that arrived after mount. */
  isNew: boolean;
  /** Tool-reported changed paths from the containing turn for system summaries. */
  knownFilePaths?: readonly string[] | undefined;
  streaming: boolean;
  /** CM-10: source session for the message context menu ref. */
  activeSessionId: string | null;
  editingMessageId: string | null;
  lastUserMessageId: string | null;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: string | number;
  runRecordsById: Record<string, RunRecordUi>;
  /** Keyed Run projection for this row; avoids whole-map memo invalidation. */
  runRecord?: RunRecordUi;
  activeRunId: string | null;
  activeSkill: SkillActivityView | null;
  agentLocatorAnimation?: AgentLocatorAnimation;
  permissionPrompt: PermissionPromptUi | null;
  workDetailsExpanded: WorkDetailsExpanded;
  toolDensity: ToolCallDensity;
  showThinking: boolean;
  /** Cross-message explore-flow role (anchor capsule / suppressed member). */
  exploreRole?: ExploreFlowRole;
  /** Project root forwarded to tool cards → DiffCard. */
  projectPath?: string | null;
  /** Host git request adapter forwarded to tool cards → DiffCard. */
  toolDiffRequest?: DiffCardRequest;
  filesChangedRequest?: FilesChangedBarRequest;
  onReviewChanges?: () => void;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  branchPoints?: TranscriptBranchPoint[];
  onSwitchBranch?: (headMessageId: string) => void;
  onInterventionEdit?: (messageId: string, text: string) => void | Promise<void>;
  onInterventionCancel?: (messageId: string) => void | Promise<void>;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
  /** Open the read-only subagent session inspector for a transcript card. */
  onInspectSubagent: ((selection: SubagentInspectorSelection) => void) | undefined;
  docCardRequest?: DocCardSequenceRequest;
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  subagentStreams?: Record<string, SubagentStreamState>;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  /** When false (default), MarkdownView hides the heavy Artifact path. */
  artifactPreviewEnabled?: boolean;
  /** When true, MarkdownView displays source code first for artifact blocks. */
  artifactCodeFirst?: boolean;
  /** Security byte cap forwarded to evaluateCodeFence. */
  artifactMaxBytes?: number;
  /** Callback when clicking a search result file or file link. */
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Open an edited file's diff in the right inspector. */
  onOpenDiff?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Callback when clicking a markdown document link or plan document chip. */
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
  /** Global composer card props so the edit mode matches the bottom composer. */
  composerCard: ComposerDockProps;
  /** Walkthrough artifacts keyed by owning assistant messageId. */
  walkthroughsByMessageId?: Record<string, WalkthroughArtifact>;
  /** Whether the Generate Walkthrough action is enabled. */
  walkthroughEnabled?: boolean;
  /** Whether auto-generation is active (hides the manual Generate button). */
  walkthroughAutoGenerate?: boolean;
  /** Pre-computed eligibility for the Generate button (computed by parent). */
  walkthroughEligible?: boolean;
  /** Generate a walkthrough for a message; force overwrites an existing artifact. */
  onGenerateWalkthrough?:
    ((messageId: string, force?: boolean) => void | Promise<void>) | undefined;
  /** Cancel an in-flight walkthrough generation. */
  onCancelWalkthrough?:
    ((messageId: string, generationId?: string) => void | Promise<void>) | undefined;
  /** SF-03: Duplicate the entire session. */
  onDuplicateSession?: (() => void | Promise<void>) | undefined;
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
  /** SF-03: Whether derived-session actions are disabled. */
  derivedActionsDisabled?: boolean;
  /** SF-03: True only for the last assistant message in a turn group. */
  isLastAssistantInTurn?: boolean;
  /** SF-04: True only for the newest completed assistant response. */
  isLatestAssistantResponse?: boolean;
  /** Assembly capsule for this user row, if Host recorded one. */
  assemblySummary?: ContextSummaryPush;
  isConversationSession?: boolean;
  onResolveFlashcards?: (itemIds: string[]) => Promise<import('@piwin/contracts').FlashcardReviewCard[]>;
  /** Flashcard create tools from the whole turn; shown on the last assistant row. */
  turnFlashcardTools?: readonly ToolCardUi[];
  livePromptModel?: ModelRef | null;
  modelOptions?: readonly ModelOption[];
  configProviders?: readonly ModelProviderConfig[];
  contextUsage?: ContextUsageSnapshot | null;
  onRegenerate?: (() => void) | undefined;
  /** Conversation only: identity header on the first visible assistant in the turn. */
  showConversationHeader?: boolean;
  /** Conversation only: turn usage chip on that identity header. */
  showConversationTurnUsage?: boolean;
};

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

function getGenerationStatus(
  message: ChatMessageUi,
  generationKind: GenerationToolKind,
): ToolCardUi['status'] | null {
  const generationTools = message.tools.filter(
    (tool) => resolveGenerationToolKind(tool) === generationKind,
  );
  if (generationTools.length === 0) {
    return null;
  }
  if (generationTools.some((tool) => tool.status === 'running')) {
    return 'running';
  }
  if (generationTools.some((tool) => tool.status === 'error')) {
    return 'error';
  }
  return 'done';
}

export const ChatMessageRow = memo(
  function ChatMessageRow(props: ChatMessageRowProps): ReactElement | null {
    const { message } = props;
    const imageGenerationStatus =
      message.role === 'assistant' ? getGenerationStatus(message, 'image') : null;
    const videoGenerationStatus =
      message.role === 'assistant' ? getGenerationStatus(message, 'video') : null;
    const contextMenu = useDesktopContextMenu();
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
        isActivelyStreaming: message.status === 'streaming',
      })
    ) {
      return null;
    }
    // Keep errored turns visible even when the provider failed before any
    // content: an empty bubble is still the only place TurnErrorCard renders.
    if (
      message.role === 'assistant' &&
      message.status !== 'streaming' &&
      message.status !== 'error' &&
      !message.error &&
      props.runRecord?.outcome !== 'failed' &&
      message.text.trim().length === 0 &&
      message.thinking.trim().length === 0 &&
      message.tools.length === 0 &&
      message.attachments.length === 0 &&
      (message.searchEvidence?.citations.length ?? 0) === 0 &&
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
      props.isConversationSession === true && isUserMessage ? 'is-conversation-bubble' : '',
      props.isConversationSession === true &&
      message.role === 'assistant' &&
      props.showConversationHeader === false
        ? 'is-turn-continuation'
        : '',
      message.role === 'assistant' &&
      message.text.trim().length === 0 &&
      message.thinking.trim().length === 0 &&
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
              runRecordsById={props.runRecordsById}
              activeRunId={props.activeRunId}
              locale={props.locale ?? 'zh-CN'}
              {...(props.livePromptModel !== undefined ? { livePromptModel: props.livePromptModel } : {})}
              {...(props.modelOptions !== undefined ? { modelOptions: props.modelOptions } : {})}
              {...(props.configProviders !== undefined ? { configProviders: props.configProviders } : {})}
              showHeader={props.showConversationHeader !== false}
              usageChip={
                props.isConversationSession === true &&
                props.showConversationHeader !== false &&
                props.showConversationTurnUsage === true
                  ? buildConversationTurnUsageChip(props.contextUsage, props.locale ?? 'zh-CN')
                  : null
              }
              isStreaming={props.streaming}
              {...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
              {...(props.artifactMaxBytes !== undefined
                ? { artifactMaxBytes: props.artifactMaxBytes }
                : {})}
              {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
              {...(props.onOpenArtifactCanvas
                ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                : {})}
              {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
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
              permissionPrompt={props.isLastAssistantInTurn === true ? props.permissionPrompt : null}
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
                  {...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
                  {...(props.artifactMaxBytes !== undefined
                    ? { artifactMaxBytes: props.artifactMaxBytes }
                    : {})}
                  {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
                  {...(props.sessionId
                    ? { artifactOrigin: { sessionId: props.sessionId, messageId: message.id } }
                    : {})}
                  {...(props.onOpenArtifactCanvas
                    ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                    : {})}
                  {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
                />
              ) : null}
                {message.searchEvidence !== undefined ? (
                  <CitationCards evidence={message.searchEvidence} />
                ) : null}
                {(() => {
                  const extractedCards = extractFlashcardRecords(message);
                  const flashcardArtifactHtml = extractFlashcardArtifactHtml(message);
                  const textHasFlashcard = isFlashcardArtifactSource(message.text);
                  const shouldRender = Boolean(
                    (extractedCards.length > 0 || flashcardArtifactHtml) && !textHasFlashcard,
                  );
                  if (!shouldRender) return null;
                  if (extractedCards.length > 0) {
                    return (
                      <div
                        className="conversation-extracted-flashcard"
                        data-testid="conversation-extracted-flashcard"
                      >
                        <FlashcardStackView
                          cards={extractedCards}
                          locale={props.locale ?? 'zh-CN'}
                          {...(props.onArtifactAction ? { onAction: props.onArtifactAction } : {})}
                        />
                      </div>
                    );
                  }
                  if (flashcardArtifactHtml) {
                    return (
                      <div
                        className="conversation-extracted-flashcard"
                        data-testid="conversation-extracted-flashcard"
                      >
                        <MarkdownView
                          text={`\`\`\`html\n${flashcardArtifactHtml}\n\`\`\``}
                          renderingPhase="completed"
                          artifactTheme={mapThemeToArtifactVariables(props.activeTheme)}
                          initPriorityBase={props.messageIndex * 10 + 1}
                          artifactThemeKey={`${props.activeTheme?.id ?? 'none'}:${props.artifactThemeKey}`}
                          showStreamingCaret={false}
                          locale={props.locale ?? 'zh-CN'}
                          artifactPreviewEnabled={true}
                          {...(props.artifactMaxBytes !== undefined
                            ? { artifactMaxBytes: props.artifactMaxBytes }
                            : {})}
                          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
                          {...(props.sessionId
                            ? { artifactOrigin: { sessionId: props.sessionId, messageId: message.id } }
                            : {})}
                          {...(props.onOpenArtifactCanvas
                            ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                            : {})}
                          {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
                        />
                      </div>
                    );
                  }
                  return null;
                })()}
              </TurnWorkDetails>
          )
        ) : null}
        {imageGenerationStatus &&
        shouldRenderGenerationProgress(imageGenerationStatus, message.attachments) ? (
          <ImageGenerationProgress
            locale={props.locale ?? 'zh-CN'}
            status={imageGenerationStatus}
          />
        ) : null}
        {videoGenerationStatus &&
        shouldRenderGenerationProgress(videoGenerationStatus, message.attachments) ? (
          <VideoGenerationProgress
            locale={props.locale ?? 'zh-CN'}
            status={videoGenerationStatus}
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
            onCancel={props.onCancelEdit}
            onResend={(text) => {
              if (canEditPendingIntervention && props.onInterventionEdit) {
                void props.onInterventionEdit(message.id, text);
                return;
              }
              props.onEditResend(message.id, text);
            }}
            interventionEdit={canEditPendingIntervention}
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
        {props.isConversationSession !== true &&
        message.role === 'assistant' &&
        message.tools.length > 0 ? (
          <FilesChangedBar
            tools={message.tools}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.filesChangedRequest !== undefined
              ? { request: props.filesChangedRequest }
              : {})}
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
        (message.status === 'error' || Boolean(message.error) || props.runRecord?.outcome === 'failed') ? (
          <TurnErrorCard
            messageId={message.id}
            error={
              message.error ||
              props.runRecord?.terminalMessage ||
              (message.status === 'error' ? (props.locale === 'zh-CN' ? '生成失败' : 'Generation failed') : null)
            }
            locale={props.locale}
            onRetry={() => {
              if (props.onRegenerate) {
                props.onRegenerate();
              } else if (props.lastUserMessageId) {
                props.onRetry(props.lastUserMessageId);
              }
            }}
            onFeedback={props.onFeedback}
          />
        ) : null}
        {message.role === 'assistant' &&
        message.status === 'done' &&
        (props.isLastAssistantInTurn === true ||
          (props.isConversationSession === true && Boolean(message.text?.trim()))) &&
        (props.onDuplicateSession ||
          props.onForkFromMessage ||
          message.text ||
          (props.isConversationSession === true &&
            props.isLatestAssistantResponse === true &&
            props.onRegenerate !== undefined)) ? (
          <AssistantResponseActions
            messageId={message.id}
            messageText={message.text}
            showDuplicate={
              props.isLastAssistantInTurn === true && props.onDuplicateSession !== undefined
            }
            showFork={
              props.isLastAssistantInTurn === true && props.onForkFromMessage !== undefined
            }
            showRegenerate={
              props.isConversationSession === true &&
              props.isLatestAssistantResponse === true &&
              props.onRegenerate !== undefined
            }
            {...(props.onRegenerate !== undefined ? { onRegenerate: props.onRegenerate } : {})}
            directForkCount={props.forkCountsByMessageId?.[message.id] ?? 0}
            {...(props.sessionLineage ? { lineage: props.sessionLineage } : {})}
            showTreeOnLatestResponse={props.isLatestAssistantResponse === true}
            disabled={props.derivedActionsDisabled === true || props.streaming}
            {...(props.onDuplicateSession
              ? { onDuplicate: props.onDuplicateSession }
              : { onDuplicate: () => {} })}
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
      props.isConversationSession !== true &&
      isUserMessage &&
      props.assemblySummary === undefined &&
      props.streaming === true &&
      props.activeRunId != null &&
      props.lastUserMessageId === message.id;
    const capsule =
      props.isConversationSession !== true &&
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
  (previous, next) => {
    const isActionableUserMessage = previous.message.role === 'user';
    // composerCard only mounts for the row being edited; ignore identity churn elsewhere.
    const isEditingThisRow =
      previous.editingMessageId === previous.message.id ||
      next.editingMessageId === next.message.id;
    const callbackPropsAreStable =
      previous.onFeedback === next.onFeedback &&
      (isActionableUserMessage
        ? previous.onEdit === next.onEdit &&
          previous.onCancelEdit === next.onCancelEdit &&
          previous.onEditResend === next.onEditResend &&
          previous.onRetry === next.onRetry &&
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
      previous.activeTheme === next.activeTheme &&
      areFilePathListsEqual(previous.knownFilePaths, next.knownFilePaths) &&
      previous.artifactThemeKey === next.artifactThemeKey &&
      previous.runRecord === next.runRecord &&
      previous.activeRunId === next.activeRunId &&
      previous.activeSkill === next.activeSkill &&
      previous.agentLocatorAnimation === next.agentLocatorAnimation &&
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
      previous.onDuplicateSession === next.onDuplicateSession &&
      previous.onForkFromMessage === next.onForkFromMessage &&
      previous.onOpenForks === next.onOpenForks &&
      previous.forkCountsByMessageId === next.forkCountsByMessageId &&
      previous.sessionLineage === next.sessionLineage &&
      previous.onOpenSession === next.onOpenSession &&
      previous.derivedActionsDisabled === next.derivedActionsDisabled &&
      previous.isLastAssistantInTurn === next.isLastAssistantInTurn &&
      previous.turnFlashcardTools === next.turnFlashcardTools &&
      previous.isLatestAssistantResponse === next.isLatestAssistantResponse &&
      previous.assemblySummary === next.assemblySummary &&
      previous.isConversationSession === next.isConversationSession &&
      previous.showConversationHeader === next.showConversationHeader &&
      previous.showConversationTurnUsage === next.showConversationTurnUsage &&
      previous.onResolveFlashcards === next.onResolveFlashcards &&
      previous.onRegenerate === next.onRegenerate &&
      previous.livePromptModel === next.livePromptModel &&
      previous.contextUsage === next.contextUsage &&
      previous.modelOptions === next.modelOptions &&
      previous.configProviders === next.configProviders &&
      callbackPropsAreStable
    );
  },
);
