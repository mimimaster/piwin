import { useEffect, useState, type ReactElement } from 'react';
import { RadialBellow } from '@piwin/ui-kit';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type {
  FlashcardReviewCard,
  ModelProviderConfig,
  ModelRef,
  ThemeManifest,
} from '@piwin/contracts';
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
import { extractFlashcardItemIdsFromText } from './resolve-conversation-flashcards.js';
import { FlashcardResultProjection } from './FlashcardResultProjection';
import { extractFlashcardRecords } from './flashcard-result-extract.js';
import { MarkdownView } from './MarkdownView';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { resolveAssistantRenderingPhase } from './streaming-caret';
import type { DocumentOpenInput } from './tool-call-card';
import { IconBrain, IconChevronRight } from './shell-icons';
import { behaviorTextClass, getBehaviorActivitySpec } from './behavior-activity.js';
import { buildTurnPresentation } from './run-presentation.js';
import { runtimeStatusText } from './run-activity-strings.js';
import { conversationActivityLabel } from './conversation-activity.js';

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
  modelOptions?: readonly ModelOption[];
  configProviders?: readonly ModelProviderConfig[];
  usageChip?: ConversationUsageChipData | null;
  isStreaming?: boolean;
  artifactPreviewEnabled: boolean;
  artifactCodeFirst?: boolean;
  artifactMaxBytes?: number;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  /** Active project root for path chips (Save As / Reveal / absolute copy). */
  projectPath?: string | null | undefined;
  /** When false, skip in-message flip cards (used for earlier tool-only rows). */
  renderExtractedFlashcards?: boolean;
  /** Extra tool cards to scan (turn-level flashcard creates). */
  sourceTools?: readonly ToolCardUi[];
  /** Fallback when tool output was stripped: resolve card ids from the reply text. */
  onResolveFlashcards?: (itemIds: string[]) => Promise<FlashcardReviewCard[]>;
  /** False for later completions in the same Conversation turn. Default true. */
  showHeader?: boolean;
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
  const hasThinking = message.thinking.trim().length > 0;
  const isThinkingActive = presentation.isThinkingActive && hasThinking;
  const thinkingOpen =
    thinkingIntent === 'user-open' || (thinkingIntent === 'automatic' && isThinkingActive);
  const thinkingLabelClass = behaviorTextClass('thinking', isThinkingActive);

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

  const resolvedModel = resolveConversationMessageModel({
    message,
    livePromptModel: props.livePromptModel ?? null,
    isStreaming: props.isStreaming ?? message.status === 'streaming',
  });

  const modelDisplay = resolvedModel
    ? resolveModelDisplayName({
        model: resolvedModel,
        ...(props.modelOptions !== undefined ? { modelOptions: props.modelOptions } : {}),
        ...(props.configProviders !== undefined ? { configProviders: props.configProviders } : {}),
      })
    : undefined;

  const showHeader = props.showHeader !== false;

  const isAwaitingFirstToken =
    (props.isStreaming ?? message.status === 'streaming') &&
    message.text.trim().length === 0 &&
    message.thinking.trim().length === 0 &&
    getMessageTools(message, props.sourceTools).length === 0;

  return (
    <div
      className={`conversation-response${showHeader ? '' : ' is-continuation'}`}
      data-testid="conversation-response"
    >
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
        <div
          className="conversation-thinking-wrapper is-open"
          data-testid="conversation-activity"
        >
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
            data-tool-status={isThinkingActive ? 'running' : 'done'}
            aria-label={locale === 'zh-CN' ? '思考过程' : 'Thoughts'}
            aria-expanded={thinkingOpen}
            data-testid="conversation-thinking-summary"
            onClick={() => setThinkingIntent(thinkingOpen ? 'user-closed' : 'user-open')}
          >
            {isThinkingActive ? (
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
              {isThinkingActive
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
                className={`turn-thinking${isThinkingActive ? ' is-streaming' : ''}`}
                data-testid="conversation-thinking"
              >
                <pre>{message.thinking}</pre>
              </div>
            </div>
          ) : null}
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
          {...(props.projectPath ? { projectPath: props.projectPath } : {})}
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
    </div>
  );
}
