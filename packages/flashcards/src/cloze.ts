/**
 * Cloze parse / projection / review-card expansion.
 * Markers follow Anki's minimum: {{cN::answer}} and {{cN::answer::hint}}.
 */
import type {
  FlashcardAttribution,
  FlashcardItem,
  FlashcardModel,
  FlashcardReviewCard,
} from '@piwin/contracts';

export const MAX_CLOZE_ORDINALS = 8;
export const CLOZE_BLANK = '[…]';

const CLOZE_RE = /\{\{c(\d+)::((?:(?!\}\}|::).)+)(?:::(?:(?!\}\}).)*)?\}\}/g;

export type ClozeMarker = {
  ordinal: number;
  answer: string;
};

export function parseClozeMarkers(text: string): ClozeMarker[] {
  const markers: ClozeMarker[] = [];
  const pattern = new RegExp(CLOZE_RE.source, 'g');
  let match = pattern.exec(text);
  while (match) {
    const ordinal = Number(match[1]);
    const answer = (match[2] ?? '').trim();
    if (Number.isInteger(ordinal) && ordinal >= 1 && answer) {
      markers.push({ ordinal, answer });
    }
    match = pattern.exec(text);
  }
  return markers;
}

export function listClozeOrdinals(text: string): number[] {
  const ordinals = new Set(parseClozeMarkers(text).map((marker) => marker.ordinal));
  return [...ordinals].sort((left, right) => left - right);
}

export function isValidClozeText(text: string): boolean {
  const ordinals = listClozeOrdinals(text);
  return ordinals.length > 0 && ordinals.length <= MAX_CLOZE_ORDINALS;
}

export function stripClozeMarkers(text: string): string {
  return text.replace(new RegExp(CLOZE_RE.source, 'g'), (_full, _ordinal, answer: string) =>
    String(answer ?? '').trim(),
  );
}

export function projectCloze(text: string, ordinal: number): { front: string; back: string } {
  const pattern = new RegExp(CLOZE_RE.source, 'g');
  let front = '';
  let back = '';
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    const start = match.index;
    const answer = (match[2] ?? '').trim();
    const markerOrdinal = Number(match[1]);
    front += text.slice(cursor, start);
    back += text.slice(cursor, start);
    if (markerOrdinal === ordinal && answer) {
      front += CLOZE_BLANK;
      back += `**${answer}**`;
    } else if (answer) {
      front += answer;
      back += answer;
    } else {
      front += match[0];
      back += match[0];
    }
    cursor = start + match[0].length;
    match = pattern.exec(text);
  }
  front += text.slice(cursor);
  back += text.slice(cursor);
  return { front, back };
}

export function reviewCardId(itemId: string, ordinal: number, model: FlashcardModel): string {
  return model === 'cloze' ? `${itemId}:c${ordinal}` : itemId;
}

export function parseReviewCardId(cardId: string): { itemId: string; ordinal: number } {
  const match = /^(.*):c(\d+)$/.exec(cardId);
  const itemId = match?.[1];
  const ordinalRaw = match?.[2];
  if (!itemId || !ordinalRaw) {
    return { itemId: cardId, ordinal: 1 };
  }
  return { itemId, ordinal: Number(ordinalRaw) };
}

export function reviewStateFileName(cardId: string): string {
  const parsed = parseReviewCardId(cardId);
  if (!cardId.includes(':c')) {
    return `${cardId}.json`;
  }
  return `${parsed.itemId}--c${parsed.ordinal}.json`;
}

export function itemPreviewText(item: FlashcardItem): string {
  if (item.model === 'cloze') {
    return stripClozeMarkers(item.text ?? '').trim();
  }
  return (item.front ?? '').trim();
}

export function expandItemToReviewCards(item: FlashcardItem): FlashcardReviewCard[] {
  if (item.model === 'cloze') {
    const text = item.text ?? '';
    if (!isValidClozeText(text)) return [];
    return listClozeOrdinals(text).map((ordinal) => {
      const projected = projectCloze(text, ordinal);
      return toReviewCard(item, ordinal, projected.front, projected.back);
    });
  }
  const front = (item.front ?? '').trim();
  const back = (item.back ?? '').trim();
  if (!front || !back) return [];
  return [toReviewCard(item, 1, front, back)];
}

function toReviewCard(
  item: FlashcardItem,
  ordinal: number,
  front: string,
  back: string,
): FlashcardReviewCard {
  const card: FlashcardReviewCard = {
    cardId: reviewCardId(item.id, ordinal, item.model),
    itemId: item.id,
    model: item.model,
    ordinal,
    deck: item.deck,
    front,
    back,
    createdAt: item.createdAt,
  };
  copyAttribution(item, card);
  return card;
}

function copyAttribution(from: FlashcardAttribution, to: FlashcardAttribution): void {
  if (from.sourceNoteId) to.sourceNoteId = from.sourceNoteId;
  if (from.sourceHash) to.sourceHash = from.sourceHash;
  if (from.sourceExcerpt) to.sourceExcerpt = from.sourceExcerpt;
  if (from.sourceFolder) to.sourceFolder = from.sourceFolder;
  if (from.sourceFile) to.sourceFile = from.sourceFile;
  if (typeof from.sourceLine === 'number') to.sourceLine = from.sourceLine;
  if (from.tags && from.tags.length > 0) to.tags = from.tags;
  if (from.sequenceId) to.sequenceId = from.sequenceId;
  if (typeof from.position === 'number') to.position = from.position;
  if (from.cardType) to.cardType = from.cardType;
  if (from.relationFromPrevious) to.relationFromPrevious = from.relationFromPrevious;
  if (from.knowledgePointIds && from.knowledgePointIds.length > 0) {
    to.knowledgePointIds = from.knowledgePointIds;
  }
  if (from.sourceChunkIds && from.sourceChunkIds.length > 0) {
    to.sourceChunkIds = from.sourceChunkIds;
  }
  if (from.generationId) to.generationId = from.generationId;
  if (from.sourceDocumentIds && from.sourceDocumentIds.length > 0) {
    to.sourceDocumentIds = from.sourceDocumentIds;
  }
}
