import {
  parseFlashcardDisplayPayload,
  type FlashcardItem,
  type FlashcardReviewCard,
} from '@piwin/contracts';
import {
  collapseToPhysicalCards,
  isValidClozeText,
  itemToDisplayCard,
} from '@piwin/flashcards/cloze';
import type { ChatMessageUi, ToolCardUi } from './chat-reducer';

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
  const createdAt =
    typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();
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
  const fromDisplay = parseFlashcardDisplayPayload(candidate);
  if (fromDisplay) return fromDisplay.cards;
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
    ? inner.cards.filter(
        (entry): entry is Record<string, unknown> =>
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

function textFromCreateTurn(message: ChatMessageUi, extraTools?: readonly ToolCardUi[]): string {
  const parts = [message.text];
  for (const tool of getMessageTools(message, extraTools)) {
    parts.push(tool.output ?? '');
    parts.push(tool.presentation?.output?.text ?? '');
    parts.push(tool.presentation?.inputPreview ?? '');
  }
  return parts.join('\n');
}

/**
 * Extract projected review cards from flashcard tool results.
 * Prefers `presentation.flashcard` / `display.cards`; never HTML.
 */
export function extractFlashcardRecords(
  message: ChatMessageUi,
  extraTools?: readonly ToolCardUi[],
): FlashcardReviewCard[] {
  const tools = getMessageTools(message, extraTools);
  const cards: FlashcardReviewCard[] = [];
  for (const tool of tools) {
    if (tool.status === 'done' && isFlashcardCreateTool(tool)) {
      const fromPresentation = parseFlashcardDisplayPayload(tool.presentation?.flashcard);
      if (fromPresentation) {
        cards.push(...fromPresentation.cards);
        continue;
      }
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
