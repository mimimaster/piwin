import { useEffect, useState, type ReactElement } from 'react';
import { RadialBellow } from '@piwin/ui-kit';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type {
  FlashcardReviewCard,
  ModelProviderConfig,
  ModelRef,
  ThemeManifest,
} from '@piwin/contracts';
import { pickArtifactFenceSecurity } from './artifact-fence-security';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import type { ChatMessageUi, RunRecordUi, ToolCardUi } from './chat-reducer';
import type { ModelOption } from './model-options';
import {
  ConversationMessageHeader,
  type ConversationUsageChipData,
} from './conversation-message-header';
import {
  resolveConversationMessageModel,
  resolveModelDisplayName,
} from './conversation-message-identity';
import { CitationCards } from './CitationCards';
import { InkstoneMessageIdentity } from './inkstone-message-identity.js';
import { ImageGenerationProgress } from './image-generation-progress';
import { MessageAttachments } from './message-attachments';
import { extractFlashcardItemIdsFromText } from './resolve-conversation-flashcards.js';
import { FlashcardResultProjection } from './FlashcardResultProjection';
import { extractFlashcardRecords, getMessageTools } from './flashcard-result-extract.js';
import { MarkdownView } from './MarkdownView';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { resolveAssistantRenderingPhase } from './streaming-caret';
import type { DocumentOpenInput } from './tool-call-card';
import type { DiffCardRequest } from './diff-card.js';
import { IconBrain, IconChevronRight } from './shell-icons';
import { behaviorTextClass, getBehaviorActivitySpec } from './behavior-activity.js';
import { buildTurnPresentation } from './run-presentation.js';
import { runtimeStatusText } from './run-activity-strings.js';
import { conversationActivityLabel } from './conversation-activity.js';
import { TurnToolGroup } from './turn-tool-group.js';
import { ExploreFlowCapsule } from './explore-flow-capsule.js';
import type { ExploreFlowRole } from './explore-flow.js';
import {
  getGenerationStatus,
  getGenerationTool,
  resolveGenerationToolKind,
  shouldRenderGenerationProgress,
} from './generation-tool-kind.js';
import { VideoGenerationProgress } from './video-generation-progress';
import type { ToolCallDensity } from './ui-preferences.js';

export {
  collectFlashcardToolsFromMessages,
  extractFlashcardRecords,
  isFlashcardCreateTool,
  messageHasFlashcardToolResult,
} from './flashcard-result-extract.js';

export function ConversationResponseContent(props: {
  message: ChatMessageUi;
  sessionId?: string;
  messageIndex: number;
  showStreamingCaret: boolean;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: string | number;
  runRecordsById: Record<string, RunRecordUi>;
  activeRunId: string | null;
  locale: 'zh-CN' | 'en';
  livePromptModel?: ModelRef | null;
  /** Latest visible Conversation reply (regenerate / copy dock). */
  isLatestAssistantResponse?: boolean;
  modelOptions?: readonly ModelOption[];
  configProviders?: readonly ModelProviderConfig[];
  usageChip?: ConversationUsageChipData | null;
  isStreaming?: boolean;
  artifactPreviewEnabled: boolean;
  artifactCodeFirst?: boolean;
  artifactMaxBytes?: number;
  artifactBlockExternalScripts?: boolean;
  artifactBlockExternalResources?: boolean;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  /** Active project root for path chips (Save As / Reveal / absolute copy). */
  projectPath?: string | null | undefined;
  toolDensity?: ToolCallDensity;
  toolDiffRequest?: DiffCardRequest;
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  onOpenDiff?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** When false, skip in-message flip cards (used for earlier tool-only rows). */
  renderExtractedFlashcards?: boolean;
  /** Extra tool cards to scan (turn-level flashcard creates). */
  sourceTools?: readonly ToolCardUi[];
  /** Fallback when tool output was stripped: resolve card ids from the reply text. */
  onResolveFlashcards?: (itemIds: string[]) => Promise<FlashcardReviewCard[]>;
  /** False for later completions in the same Conversation turn. Default true. */
  showHeader?: boolean;
  /** Supplementary panes bypass ChatMessageRow, so they opt into media chrome here. */
  renderMediaChrome?: boolean;
  /** Cross-message explore-flow role (anchor capsule / suppressed member). */
  exploreRole?: ExploreFlowRole;
  showThinking?: boolean;
}): ReactElement {
  const { message, locale } = props;
  const presentation = buildTurnPresentation({
    message,
    runRecordsById: props.runRecordsById,
    activeRunId: props.activeRunId,
    permissionPrompt: null,
    locale,
  });

  const [thinkingIntent, setThinkingIntent] = useState<'automatic' | 'user-open' | 'user-closed'>(
    'automatic',
  );
  const exploreRole = props.exploreRole;
  const isFlowAnchor = exploreRole?.kind === 'anchor';
  const isFlowMember = exploreRole?.kind === 'member';
  const isFoldThought = exploreRole?.kind === 'fold-thought';
  const hasThinking =
    message.thinking.trim().length > 0 &&
    !isFlowMember &&
    !isFoldThought &&
    !(isFlowAnchor && message.text.trim().length === 0);
  const liveStreaming = props.isStreaming === true;
  // Keep reasoning visible for the whole live bubble. Turn presentation marks
  // thinking inactive as soon as a caption or tool appears, which hid grok
  // xhigh reasoning behind a frozen locator for minutes. Durable
  // `status=streaming` after a missed terminal must not keep the spinner.
  const thinkingStreaming =
    liveStreaming &&
    message.status === 'streaming' &&
    hasThinking &&
    message.thinkingEndedAt === undefined;
  const thinkingOpen =
    thinkingIntent === 'user-open' ||
    (thinkingIntent === 'automatic' &&
      liveStreaming &&
      message.status === 'streaming' &&
      hasThinking);
  const thinkingLabelClass = behaviorTextClass('thinking', thinkingStreaming);
  const composingToolArgs =
    liveStreaming &&
    message.status === 'streaming' &&
    message.tools.length === 0 &&
    message.text.trim().length === 0 &&
    (message.toolArgsProgress !== undefined ||
      (hasThinking && message.thinkingEndedAt !== undefined));
  const composingLabel = formatToolArgsProgressLabel({
    locale,
    argumentCharCount: message.toolArgsProgress?.argumentCharCount ?? 0,
    ...(message.toolArgsProgress?.toolName !== undefined
      ? { toolName: message.toolArgsProgress.toolName }
      : {}),
  });

  const extractedCards =
    props.renderExtractedFlashcards === false
      ? []
      : extractFlashcardRecords(message, props.sourceTools);
  const [resolvedCards, setResolvedCards] = useState<FlashcardReviewCard[]>([]);
  useEffect(() => {
    if (props.renderExtractedFlashcards === false) {
      setResolvedCards([]);
      return;
    }
    if (extractedCards.length > 0 || !props.onResolveFlashcards) {
      setResolvedCards([]);
      return;
    }
    const itemIds = extractFlashcardItemIdsFromText(message.text);
    if (itemIds.length === 0) {
      setResolvedCards([]);
      return;
    }
    let cancelled = false;
    void props.onResolveFlashcards(itemIds).then((cards) => {
      if (!cancelled) setResolvedCards(cards);
    });
    return () => {
      cancelled = true;
    };
  }, [
    extractedCards.length,
    message.text,
    props.onResolveFlashcards,
    props.renderExtractedFlashcards,
  ]);
  const displayCards = extractedCards.length > 0 ? extractedCards : resolvedCards;
  const conversationTools =
    isFlowAnchor || isFlowMember
      ? []
      : message.tools.filter((tool) => resolveGenerationToolKind(tool) === null);
  const imageGenerationStatus = getGenerationStatus(message, 'image');
  const videoGenerationStatus = getGenerationStatus(message, 'video');
  const imageGenerationTool = getGenerationTool(message, 'image');
  const videoGenerationTool = getGenerationTool(message, 'video');
  const resolvedModel = resolveConversationMessageModel({
    message,
    livePromptModel: props.livePromptModel ?? null,
    isStreaming: liveStreaming,
  });

  const modelDisplay = resolvedModel
    ? resolveModelDisplayName({
        model: resolvedModel,
        ...(props.modelOptions !== undefined ? { modelOptions: props.modelOptions } : {}),
        ...(props.configProviders !== undefined ? { configProviders: props.configProviders } : {}),
      })
    : undefined;

  const showHeader = props.showHeader !== false;
  const renderMediaChrome = props.renderMediaChrome === true;

  const isAwaitingFirstToken =
    liveStreaming &&
    message.text.trim().length === 0 &&
    message.thinking.trim().length === 0 &&
    getMessageTools(message, props.sourceTools).length === 0;

  return (
    <div
      className={`conversation-response${showHeader ? '' : ' is-continuation'}`}
      data-testid="conversation-response"
    >
      {showHeader ? <InkstoneMessageIdentity message={message} locale={locale} /> : null}
      {showHeader ? (
        <ConversationMessageHeader
          message={message}
          {...(resolvedModel !== undefined ? { model: resolvedModel } : {})}
          {...(modelDisplay?.providerName !== undefined
            ? { providerName: modelDisplay.providerName }
            : {})}
          {...(modelDisplay?.shortModelName !== undefined
            ? { shortModelName: modelDisplay.shortModelName }
            : {})}
          {...(modelDisplay?.modelLabel !== undefined
            ? { modelLabel: modelDisplay.modelLabel }
            : {})}
          {...(props.usageChip !== undefined ? { usageChip: props.usageChip } : {})}
          locale={locale}
        />
      ) : null}
      {isAwaitingFirstToken ? (
        <div className="conversation-thinking-wrapper is-open" data-testid="conversation-activity">
          <div
            className="turn-work-details-summary conversation-thinking-summary"
            data-activity-id="thinking"
            data-tool-status="running"
          >
            <span
              className="turn-summary-active-animation"
              data-testid="conversation-thinking-active-animation"
              aria-hidden="true"
            >
              <RadialBellow
                size="sm"
                label={conversationActivityLabel('thinking', locale)}
                testId="conversation-thinking-radial-bellow"
              />
            </span>
            <span
              className="turn-work-details-label turn-work-details-label--running agent-locator-copy--shimmer"
              data-testid="conversation-activity-copy"
            >
              {conversationActivityLabel('thinking', locale)}
            </span>
          </div>
        </div>
      ) : null}
      {hasThinking ? (
        <div
          className={`conversation-thinking-wrapper${thinkingOpen ? ' is-open' : ' is-collapsed'}`}
          data-testid="conversation-thinking-wrapper"
        >
          <button
            type="button"
            className="turn-work-details-summary conversation-thinking-summary"
            data-activity-id="thinking"
            data-activity-animation={getBehaviorActivitySpec('thinking').animation}
            data-tool-status={thinkingStreaming ? 'running' : 'done'}
            aria-label={locale === 'zh-CN' ? '思考过程' : 'Thoughts'}
            aria-expanded={thinkingOpen}
            data-testid="conversation-thinking-summary"
            onClick={() => setThinkingIntent(thinkingOpen ? 'user-closed' : 'user-open')}
          >
            {thinkingStreaming ? (
              <span
                className="turn-summary-active-animation"
                data-testid="conversation-thinking-active-animation"
                aria-hidden="true"
              >
                <RadialBellow
                  size="sm"
                  label={locale === 'zh-CN' ? '正在思考' : 'Thinking'}
                  testId="conversation-thinking-radial-bellow"
                />
              </span>
            ) : (
              <IconBrain className="turn-summary-brain-icon" />
            )}
            <span className={`turn-work-details-label ${thinkingLabelClass}`}>
              {thinkingStreaming
                ? runtimeStatusText('thinking', locale)
                : presentation.thoughtSeconds !== undefined
                  ? locale === 'zh-CN'
                    ? `已思考 ${presentation.thoughtSeconds} 秒`
                    : `Thought for ${presentation.thoughtSeconds}s`
                  : locale === 'zh-CN'
                    ? '思考过程'
                    : 'Thoughts'}
            </span>
            <span
              className={`turn-work-details-chevron${thinkingOpen ? ' is-open' : ''}`}
              aria-hidden
            >
              <IconChevronRight />
            </span>
          </button>
          {thinkingOpen ? (
            <div className="turn-work-details-body conversation-thinking-body">
              <div
                className={`turn-thinking${thinkingStreaming ? ' is-streaming' : ''}`}
                data-testid="conversation-thinking"
              >
                <pre>{message.thinking}</pre>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {composingToolArgs ? (
        <div
          className="conversation-thinking-wrapper is-open"
          data-testid="conversation-tool-args-progress"
        >
          <div
            className="turn-work-details-summary conversation-thinking-summary"
            data-activity-id="tool.compose"
            data-activity-animation={getBehaviorActivitySpec('tool.compose').animation}
            data-tool-status="running"
          >
            <span className="turn-summary-active-animation" aria-hidden="true">
              <RadialBellow
                size="sm"
                label={composingLabel}
                testId="conversation-tool-args-radial-bellow"
              />
            </span>
            <span className={`turn-work-details-label ${behaviorTextClass('tool.compose', true)}`}>
              {composingLabel}
            </span>
          </div>
        </div>
      ) : null}

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
          locale={locale}
          artifactPreviewEnabled={props.artifactPreviewEnabled}
          {...(props.artifactCodeFirst !== undefined
            ? { artifactCodeFirst: props.artifactCodeFirst }
            : {})}
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
        />
      ) : null}

      {isFlowAnchor && exploreRole?.kind === 'anchor' ? (
        <div className="thread turn-tool-sequence">
          <ExploreFlowCapsule
            group={exploreRole.group}
            locale={locale}
            {...(props.showThinking !== undefined ? { showThinking: props.showThinking } : {})}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.toolDiffRequest !== undefined ? { request: props.toolDiffRequest } : {})}
            {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
            {...(props.onOpenDiff !== undefined ? { onOpenDiff: props.onOpenDiff } : {})}
            {...(props.onOpenDocument !== undefined
              ? { onOpenDocument: props.onOpenDocument }
              : {})}
          />
        </div>
      ) : conversationTools.length > 0 ? (
        <TurnToolGroup
          tools={conversationTools}
          density={props.toolDensity ?? 'compact'}
          locale={locale}
          {...(props.modelOptions !== undefined ? { modelOptions: props.modelOptions } : {})}
          {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
          {...(props.toolDiffRequest !== undefined ? { request: props.toolDiffRequest } : {})}
          {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
          {...(props.onOpenDiff !== undefined ? { onOpenDiff: props.onOpenDiff } : {})}
          {...(props.onOpenDocument !== undefined ? { onOpenDocument: props.onOpenDocument } : {})}
        />
      ) : null}

      <FlashcardResultProjection
        cards={displayCards}
        locale={locale}
        {...(props.onArtifactAction ? { onAction: props.onArtifactAction } : {})}
      />

      {message.searchEvidence !== undefined ? (
        <CitationCards evidence={message.searchEvidence} />
      ) : null}
      {renderMediaChrome &&
      imageGenerationStatus &&
      shouldRenderGenerationProgress(imageGenerationStatus, message.attachments) ? (
        <ImageGenerationProgress
          locale={locale}
          status={imageGenerationStatus}
          {...(imageGenerationTool ? { tool: imageGenerationTool } : {})}
        />
      ) : null}
      {renderMediaChrome &&
      videoGenerationStatus &&
      shouldRenderGenerationProgress(videoGenerationStatus, message.attachments) ? (
        <VideoGenerationProgress
          locale={locale}
          status={videoGenerationStatus}
          {...(videoGenerationTool ? { tool: videoGenerationTool } : {})}
        />
      ) : null}
      {renderMediaChrome ? (
        <MessageAttachments
          attachments={message.attachments}
          {...(message.contextRefs ? { contextRefs: message.contextRefs } : {})}
          role="assistant"
          locale={locale}
        />
      ) : null}
    </div>
  );
}

function formatToolArgsProgressLabel(input: {
  locale: 'zh-CN' | 'en';
  argumentCharCount: number;
  toolName?: string;
}): string {
  const sizeLabel = formatArgumentCharCount(input.argumentCharCount);
  if (input.locale === 'zh-CN') {
    if (input.toolName !== undefined && sizeLabel !== undefined) {
      return `正在生成 ${input.toolName}… ${sizeLabel}`;
    }
    if (input.toolName !== undefined) {
      return `正在生成 ${input.toolName}…`;
    }
    return sizeLabel !== undefined ? `正在生成内容… ${sizeLabel}` : '正在生成内容…';
  }
  if (input.toolName !== undefined && sizeLabel !== undefined) {
    return `Composing ${input.toolName}… ${sizeLabel}`;
  }
  if (input.toolName !== undefined) {
    return `Composing ${input.toolName}…`;
  }
  return sizeLabel !== undefined ? `Composing content… ${sizeLabel}` : 'Composing content…';
}

function formatArgumentCharCount(count: number): string | undefined {
  if (count <= 0) {
    return undefined;
  }
  if (count < 1000) {
    return `${count}`;
  }
  const thousands = count / 1000;
  if (thousands < 100) {
    return `${thousands.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${Math.round(thousands)}k`;
}
