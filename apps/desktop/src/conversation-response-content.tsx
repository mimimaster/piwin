import { useState, type ReactElement } from 'react';
import { RadialBellow } from '@piwin/ui-kit';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { ModelProviderConfig, ModelRef, ThemeManifest } from '@piwin/contracts';
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
import {
  isFlashcardArtifactSource,
  renderFlashcardHtml,
  renderFlashcardBatchHtml,
} from './flashcard-artifact';
import type { FlashcardItem, FlashcardReviewCard } from '@piwin/contracts';
import { expandItemToReviewCards } from '@piwin/flashcards/cloze';
import { FlashcardStackView } from './FlashcardView';
import { MarkdownView } from './MarkdownView';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { resolveAssistantRenderingPhase } from './streaming-caret';
import type { DocumentOpenInput } from './tool-call-card';
import { IconBrain, IconChevronRight } from './shell-icons';
import { behaviorTextClass, getBehaviorActivitySpec } from './behavior-activity.js';
import { buildTurnPresentation } from './run-presentation.js';
import { runtimeStatusText } from './run-activity-strings.js';

function getMessageTools(message: ChatMessageUi): readonly ToolCardUi[] {
  const withOriginal = message as ChatMessageUi & { originalTools?: readonly ToolCardUi[] };
  if (Array.isArray(withOriginal.originalTools) && withOriginal.originalTools.length > 0) {
    return withOriginal.originalTools;
  }
  return message.tools;
}

export function messageHasFlashcardToolResult(message: ChatMessageUi): boolean {
  const tools = getMessageTools(message);
  return tools.some((tool) => {
    const name = (tool.presentation?.routedToolName ?? tool.toolName).toLowerCase();
    return (
      tool.status === 'done' &&
      (name.includes('flashcard_create') || name.includes('flashcard_batch_create'))
    );
  });
}

function asItem(value: unknown): FlashcardItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  const model = record.model === 'cloze' ? 'cloze' : 'basic';
  const deck = typeof record.deck === 'string' && record.deck ? record.deck : 'default';
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  if (model === 'cloze') {
    if (typeof record.text !== 'string' || !record.text.trim()) return null;
    return {
      id: record.id,
      model,
      deck,
      text: record.text,
      createdAt,
      ...(tags.length > 0 ? { tags } : {}),
    };
  }
  if (typeof record.front !== 'string' || typeof record.back !== 'string') return null;
  if (!record.front.trim() || !record.back.trim()) return null;
  return {
    id: record.id,
    model: 'basic',
    deck,
    front: record.front,
    back: record.back,
    createdAt,
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function parseCandidateForCards(candidate: unknown): FlashcardReviewCard[] {
  if (!candidate) return [];
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    try {
      return parseCandidateForCards(JSON.parse(candidate));
    } catch {
      return [];
    }
  }
  if (typeof candidate !== 'object' || candidate === null) return [];
  const obj = candidate as {
    card?: unknown;
    cards?: unknown;
    created?: unknown;
    text?: string;
  };
  const items: FlashcardItem[] = [];
  const single = asItem(obj.card);
  if (single) items.push(single);
  for (const entry of [obj.cards, obj.created]) {
    if (!Array.isArray(entry)) continue;
    for (const value of entry) {
      const item = asItem(value);
      if (item) items.push(item);
    }
  }
  if (items.length > 0) {
    return items.flatMap((item) => expandItemToReviewCards(item));
  }
  if (typeof obj.text === 'string' && obj.text.trim().length > 0) {
    return parseCandidateForCards(obj.text);
  }
  return [];
}

/**
 * Extract projected review cards from flashcard tool outputs.
 */
export function extractFlashcardRecords(message: ChatMessageUi): FlashcardReviewCard[] {
  const tools = getMessageTools(message);
  const cards: FlashcardReviewCard[] = [];
  for (const tool of tools) {
    const name = (tool.presentation?.routedToolName ?? tool.toolName).toLowerCase();
    if (
      tool.status === 'done' &&
      (name.includes('flashcard_create') || name.includes('flashcard_batch_create'))
    ) {
      const candidates: unknown[] = [
        tool.presentation?.output?.text,
        tool.output,
        tool.presentation?.output,
      ];
      let extracted: FlashcardReviewCard[] = [];
      for (const candidate of candidates) {
        extracted = parseCandidateForCards(candidate);
        if (extracted.length > 0) break;
      }
      if (extracted.length > 0) {
        cards.push(...extracted);
        continue;
      }
      const rawArgs = (tool as ToolCardUi & { args?: unknown }).args;
      if (rawArgs && typeof rawArgs === 'object') {
        const args = rawArgs as Record<string, unknown>;
        const inner = (args.arguments && typeof args.arguments === 'object' ? args.arguments : args) as Record<string, unknown>;
        if (typeof inner.front === 'string' && typeof inner.back === 'string' && inner.front.trim().length > 0) {
          cards.push(
            ...expandItemToReviewCards({
              id: `card-${tool.toolCallId}`,
              model: 'basic',
              front: inner.front,
              back: inner.back,
              deck: typeof inner.deck === 'string' ? inner.deck : 'default',
              createdAt: new Date().toISOString(),
            }),
          );
        }
      }
    }
  }
  return cards;
}

/**
 * Extract flashcard artifact HTML from tool results when the model summarizes in text
 * rather than copy-pasting the HTML fence. Rebuilds using the high-standard card template.
 */
export function extractFlashcardArtifactHtml(message: ChatMessageUi): string | null {
  const cards = extractFlashcardRecords(message);
  if (cards.length === 1 && cards[0]) {
    return renderFlashcardHtml(cards[0]);
  }
  if (cards.length > 1) {
    return renderFlashcardBatchHtml(cards);
  }
  const tools = getMessageTools(message);
  for (const tool of tools) {
    const name = (tool.presentation?.routedToolName ?? tool.toolName).toLowerCase();
    if (
      tool.status === 'done' &&
      (name.includes('flashcard_create') || name.includes('flashcard_batch_create'))
    ) {
      const candidates: unknown[] = [
        tool.presentation?.output?.text,
        tool.output,
        tool.presentation?.output,
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        if (typeof candidate === 'string' && isFlashcardArtifactSource(candidate)) {
          return candidate;
        }
        if (typeof candidate === 'object' && candidate !== null) {
          const obj = candidate as { artifactHtml?: unknown; text?: unknown };
          if (typeof obj.artifactHtml === 'string' && obj.artifactHtml.length > 0) {
            return obj.artifactHtml;
          }
          if (typeof obj.text === 'string' && isFlashcardArtifactSource(obj.text)) {
            return obj.text;
          }
        }
      }
    }
  }
  return null;
}

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
  artifactPreviewEnabled?: boolean;
  artifactMaxBytes?: number;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
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

  const extractedCards = extractFlashcardRecords(message);
  const flashcardArtifactHtml = extractFlashcardArtifactHtml(message);
  const textHasFlashcard = isFlashcardArtifactSource(message.text);
  const shouldRenderExtractedFlashcard = Boolean(
    (extractedCards.length > 0 || flashcardArtifactHtml) && !textHasFlashcard,
  );

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

  return (
    <div className="conversation-response" data-testid="conversation-response">
      <ConversationMessageHeader
        message={message}
        {...(resolvedModel !== undefined ? { model: resolvedModel } : {})}
        {...(modelDisplay?.providerName !== undefined ? { providerName: modelDisplay.providerName } : {})}
        {...(modelDisplay?.shortModelName !== undefined ? { shortModelName: modelDisplay.shortModelName } : {})}
        {...(modelDisplay?.modelLabel !== undefined ? { modelLabel: modelDisplay.modelLabel } : {})}
        {...(props.usageChip !== undefined ? { usageChip: props.usageChip } : {})}
        locale={locale}
      />
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

      {extractedCards.length > 0 ? (
        <div
          className="conversation-extracted-flashcard"
          data-testid="conversation-extracted-flashcard"
        >
          <FlashcardStackView
            cards={extractedCards}
            locale={locale}
            {...(props.onArtifactAction ? { onAction: props.onArtifactAction } : {})}
          />
        </div>
      ) : shouldRenderExtractedFlashcard && flashcardArtifactHtml ? (
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
            locale={locale}
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
      ) : null}

      {message.searchEvidence !== undefined ? (
        <CitationCards evidence={message.searchEvidence} />
      ) : null}
    </div>
  );
}
