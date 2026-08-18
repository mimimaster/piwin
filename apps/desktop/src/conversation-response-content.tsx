import { useEffect, useState, type ReactElement } from 'react';
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
import { collapseToPhysicalCards, isValidClozeText, itemToDisplayCard } from '@piwin/flashcards/cloze';
import { extractFlashcardItemIdsFromText } from './resolve-conversation-flashcards.js';
import { FlashcardStackView } from './FlashcardView';
import { MarkdownView } from './MarkdownView';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { resolveAssistantRenderingPhase } from './streaming-caret';
import type { DocumentOpenInput } from './tool-call-card';
import { IconBrain, IconChevronRight } from './shell-icons';
import { behaviorTextClass, getBehaviorActivitySpec } from './behavior-activity.js';
import { buildTurnPresentation } from './run-presentation.js';
import { runtimeStatusText } from './run-activity-strings.js';

function getMessageTools(
  message: ChatMessageUi,
  extraTools?: readonly ToolCardUi[],
): readonly ToolCardUi[] {
  if (extraTools && extraTools.length > 0) {
    return extraTools;
  }
  const withOriginal = message as ChatMessageUi & { originalTools?: readonly ToolCardUi[] };
  if (Array.isArray(withOriginal.originalTools) && withOriginal.originalTools.length > 0) {
    return withOriginal.originalTools;
  }
  return message.tools;
}

export function isFlashcardCreateTool(tool: ToolCardUi): boolean {
  const names = [tool.toolName, tool.presentation?.routedToolName, tool.presentation?.title]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase());
  if (
    names.some(
      (name) => name.includes('flashcard_create') || name.includes('flashcard_batch_create'),
    )
  ) {
    return true;
  }
  const blob = `${tool.output ?? ''}\n${tool.presentation?.output?.text ?? ''}`;
  return blob.includes('flashcard_batch_create') || /"model"\s*:\s*"cloze"/.test(blob);
}

export function messageHasFlashcardToolResult(
  message: ChatMessageUi,
  extraTools?: readonly ToolCardUi[],
): boolean {
  return getMessageTools(message, extraTools).some(
    (tool) => tool.status === 'done' && isFlashcardCreateTool(tool),
  );
}

/** Flashcard create/batch tools from every message in a turn. */
export function collectFlashcardToolsFromMessages(
  messages: readonly ChatMessageUi[],
): ToolCardUi[] {
  const tools: ToolCardUi[] = [];
  for (const message of messages) {
    for (const tool of getMessageTools(message)) {
      if (tool.status === 'done' && isFlashcardCreateTool(tool)) {
        tools.push(tool);
      }
    }
  }
  return tools;
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
    skipped?: unknown;
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
  if (Array.isArray(obj.skipped)) {
    for (const value of obj.skipped) {
      if (!value || typeof value !== 'object') continue;
      const record = value as { existing?: unknown };
      const existing = asItem(record.existing);
      if (existing) items.push(existing);
    }
  }
  if (items.length > 0) {
    return items.flatMap((item) => {
      const display = itemToDisplayCard(item);
      return display ? [display] : [];
    });
  }
  if (typeof obj.text === 'string' && obj.text.trim().length > 0) {
    return parseCandidateForCards(obj.text);
  }
  return [];
}

function displayCardFromCreateInput(
  input: Record<string, unknown>,
  id: string,
): FlashcardReviewCard | null {
  const deck = typeof input.deck === 'string' && input.deck ? input.deck : 'default';
  const createdAt = new Date().toISOString();
  if (input.model === 'cloze' && typeof input.text === 'string' && input.text.trim()) {
    return itemToDisplayCard({
      id,
      model: 'cloze',
      text: input.text,
      deck,
      createdAt,
    });
  }
  if (typeof input.front === 'string' && typeof input.back === 'string' && input.front.trim()) {
    return itemToDisplayCard({
      id,
      model: 'basic',
      front: input.front,
      back: input.back,
      deck,
      createdAt,
    });
  }
  return null;
}

function displayCardsFromClozeInText(text: string, id: string): FlashcardReviewCard[] {
  const pattern = /[^\n]*\{\{c\d+::[\s\S]*?\}\}[^\n]*/g;
  let match = pattern.exec(text);
  while (match) {
    const passage = match[0].replace(/^[`\s]+|[`\s]+$/g, '').trim();
    if (isValidClozeText(passage)) {
      const display = itemToDisplayCard({
        id,
        model: 'cloze',
        text: passage,
        deck: 'default',
        createdAt: new Date().toISOString(),
      });
      return display ? [display] : [];
    }
    match = pattern.exec(text);
  }
  return [];
}

function displayCardsFromToolArgs(rawArgs: unknown, toolCallId: string): FlashcardReviewCard[] {
  if (!rawArgs || typeof rawArgs !== 'object') return [];
  const args = rawArgs as Record<string, unknown>;
  const inner = (
    args.arguments && typeof args.arguments === 'object' ? args.arguments : args
  ) as Record<string, unknown>;
  const inputs: Record<string, unknown>[] = Array.isArray(inner.cards)
    ? inner.cards.filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [inner];
  const cards: FlashcardReviewCard[] = [];
  inputs.forEach((input, index) => {
    const display = displayCardFromCreateInput(input, `card-${toolCallId}-${index}`);
    if (display) cards.push(display);
  });
  return cards;
}

/**
 * Extract projected review cards from flashcard tool outputs.
 */
export function extractFlashcardRecords(
  message: ChatMessageUi,
  extraTools?: readonly ToolCardUi[],
): FlashcardReviewCard[] {
  const tools = getMessageTools(message, extraTools);
  const cards: FlashcardReviewCard[] = [];
  for (const tool of tools) {
    if (tool.status === 'done' && isFlashcardCreateTool(tool)) {
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
      const fromArgs = displayCardsFromToolArgs(
        (tool as ToolCardUi & { args?: unknown }).args,
        tool.toolCallId,
      );
      if (fromArgs.length > 0) {
        cards.push(...fromArgs);
      }
    }
  }
  const physical = collapseToPhysicalCards(cards);
  if (physical.length > 0) return physical;
  if (tools.some((tool) => tool.status === 'done' && isFlashcardCreateTool(tool))) {
    return displayCardsFromClozeInText(textFromCreateTurn(message, extraTools), message.id);
  }
  return physical;
}

function textFromCreateTurn(
  message: ChatMessageUi,
  extraTools?: readonly ToolCardUi[],
): string {
  const parts = [message.text];
  for (const tool of getMessageTools(message, extraTools)) {
    parts.push(tool.output ?? '');
    parts.push(tool.presentation?.output?.text ?? '');
    parts.push(tool.presentation?.inputPreview ?? '');
  }
  return parts.join('\n');
}

/**
 * Extract flashcard artifact HTML from tool results when the model summarizes in text
 * rather than copy-pasting the HTML fence. Rebuilds using the high-standard card template.
 */
export function extractFlashcardArtifactHtml(
  message: ChatMessageUi,
  extraTools?: readonly ToolCardUi[],
): string | null {
  const cards = extractFlashcardRecords(message, extraTools);
  if (cards.length === 1 && cards[0]) {
    return renderFlashcardHtml(cards[0]);
  }
  if (cards.length > 1) {
    return renderFlashcardBatchHtml(cards);
  }
  const tools = getMessageTools(message, extraTools);
  for (const tool of tools) {
    if (tool.status === 'done' && isFlashcardCreateTool(tool)) {
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
  /** When false, skip in-message flip cards (used for earlier tool-only rows). */
  renderExtractedFlashcards?: boolean;
  /** Extra tool cards to scan (turn-level flashcard creates). */
  sourceTools?: readonly ToolCardUi[];
  /** Fallback when tool output was stripped: resolve card ids from the reply text. */
  onResolveFlashcards?: (itemIds: string[]) => Promise<FlashcardReviewCard[]>;
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
  }, [extractedCards.length, message.text, props.onResolveFlashcards, props.renderExtractedFlashcards]);
  const displayCards = extractedCards.length > 0 ? extractedCards : resolvedCards;
  const flashcardArtifactHtml =
    props.renderExtractedFlashcards === false || displayCards.length > 0
      ? null
      : extractFlashcardArtifactHtml(message, props.sourceTools);
  const textHasFlashcard = isFlashcardArtifactSource(message.text);
  const shouldRenderExtractedFlashcard = Boolean(
    (displayCards.length > 0 || flashcardArtifactHtml) && !textHasFlashcard,
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

      {displayCards.length > 0 ? (
        <div
          className="conversation-extracted-flashcard"
          data-testid="conversation-extracted-flashcard"
        >
          <FlashcardStackView
            cards={displayCards}
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
