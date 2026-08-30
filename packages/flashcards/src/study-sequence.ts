import type {
  FlashcardItem,
  FlashcardReviewCard,
  FlashcardStudyEntry,
  ReviewState,
} from '@piwin/contracts';
import { reviewStateRevision } from '@piwin/contracts';
import { itemPreviewText } from './cloze.js';

export type FlashcardTile =
  | { kind: 'single'; id: string; card: FlashcardItem }
  | { kind: 'set'; id: string; sequenceId: string; cards: FlashcardItem[] };

export function isValidSequencePosition(position: number | undefined): position is number {
  return typeof position === 'number' && Number.isFinite(position) && position > 0;
}

export function compareSequenceMembers(left: FlashcardItem, right: FlashcardItem): number {
  const leftPos = left.position;
  const rightPos = right.position;
  const leftValid = isValidSequencePosition(leftPos);
  const rightValid = isValidSequencePosition(rightPos);
  if (leftValid && rightValid && leftPos !== rightPos) {
    return leftPos - rightPos;
  }
  if (leftValid && !rightValid) return -1;
  if (!leftValid && rightValid) return 1;
  const created = left.createdAt.localeCompare(right.createdAt);
  if (created !== 0) return created;
  return left.id.localeCompare(right.id);
}

export function sortSequenceMembers(items: readonly FlashcardItem[]): FlashcardItem[] {
  return [...items].sort(compareSequenceMembers);
}

function tileCreatedAt(tile: FlashcardTile): string {
  if (tile.kind === 'single') return tile.card.createdAt;
  return tile.cards[0]?.createdAt ?? '';
}

/** One gallery tile per lone card, or per `sequenceId` with two or more cards. */
export function groupFlashcardTiles(cards: readonly FlashcardItem[]): FlashcardTile[] {
  const grouped = new Map<string, FlashcardItem[]>();
  const singles: FlashcardItem[] = [];

  for (const card of cards) {
    const sequenceId = card.sequenceId?.trim();
    if (!sequenceId) {
      singles.push(card);
      continue;
    }
    const existing = grouped.get(sequenceId);
    if (existing) existing.push(card);
    else grouped.set(sequenceId, [card]);
  }

  const tiles: FlashcardTile[] = [];
  for (const [sequenceId, members] of grouped) {
    const ordered = sortSequenceMembers(members);
    const first = ordered[0];
    if (!first) continue;
    if (ordered.length === 1) {
      tiles.push({ kind: 'single', id: first.id, card: first });
      continue;
    }
    tiles.push({ kind: 'set', id: sequenceId, sequenceId, cards: ordered });
  }
  for (const card of singles) {
    tiles.push({ kind: 'single', id: card.id, card });
  }

  return tiles.sort((left, right) => tileCreatedAt(right).localeCompare(tileCreatedAt(left)));
}

export function tileCards(tile: FlashcardTile): FlashcardItem[] {
  return tile.kind === 'single' ? [tile.card] : tile.cards;
}

export function tileMatchesQuery(tile: FlashcardTile, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return tileCards(tile).some((card) => {
    const hay = `${card.front ?? ''} ${card.back ?? ''} ${card.text ?? ''} ${card.deck}`.toLowerCase();
    return hay.includes(needle);
  });
}

export function tilePreview(tile: FlashcardTile): string {
  const first = tileCards(tile)[0];
  return first ? itemPreviewText(first) : '';
}

export function captureSequenceMembers(
  items: readonly FlashcardItem[],
  sequenceId: string,
): FlashcardItem[] {
  return sortSequenceMembers(items.filter((item) => item.sequenceId === sequenceId));
}

export function selectParentMembersPreservingOrder(
  parentOrderedIds: readonly string[],
  itemIds: readonly string[],
): { ok: true; itemIds: string[] } | { ok: false; error: string } {
  const parentIndex = new Map<string, number>();
  parentOrderedIds.forEach((itemId, index) => {
    parentIndex.set(itemId, index);
  });
  for (const itemId of itemIds) {
    if (!parentIndex.has(itemId)) {
      return { ok: false, error: 'selection must be a subset of parent-round members' };
    }
  }
  const selected = new Set(itemIds);
  return {
    ok: true,
    itemIds: parentOrderedIds.filter((itemId) => selected.has(itemId)),
  };
}

export function sequenceEntryId(itemId: string): string {
  return `se-${itemId}`;
}

export function scheduledEntryId(itemId: string, ordinal: number): string {
  return `re-${itemId}-c${ordinal}`;
}

export function buildSequenceEntries(
  items: readonly FlashcardItem[],
  contentVersion: string | ((item: FlashcardItem) => string),
): FlashcardStudyEntry[] {
  const versionFor =
    typeof contentVersion === 'function' ? contentVersion : () => contentVersion;
  return sortSequenceMembers(items).map((item) => {
    const entry: FlashcardStudyEntry = {
      entryId: sequenceEntryId(item.id),
      itemId: item.id,
      contentVersion: versionFor(item),
      state: 'pending',
      needsReview: false,
    };
    if (typeof item.position === 'number' && Number.isFinite(item.position)) {
      entry.capturedPosition = item.position;
    }
    return entry;
  });
}

export function buildScheduledEntries(
  cards: readonly FlashcardReviewCard[],
  states: ReadonlyMap<string, ReviewState>,
  contentVersion: string | ((card: FlashcardReviewCard) => string),
): FlashcardStudyEntry[] {
  const versionFor =
    typeof contentVersion === 'function' ? contentVersion : () => contentVersion;
  return cards.map((card) => {
    const state = states.get(card.cardId);
    const entry: FlashcardStudyEntry = {
      entryId: scheduledEntryId(card.itemId, card.ordinal),
      itemId: card.itemId,
      cardId: card.cardId,
      ordinal: card.ordinal,
      reviewStateRevision: reviewStateRevision(state ?? {}),
      contentVersion: versionFor(card),
      state: 'pending',
      needsReview: false,
    };
    if (typeof card.position === 'number' && Number.isFinite(card.position)) {
      entry.capturedPosition = card.position;
    }
    return entry;
  });
}
