import type { FlashcardItem } from '@piwin/contracts';

export type FlashcardTile =
  | { kind: 'single'; id: string; card: FlashcardItem }
  | { kind: 'set'; id: string; sequenceId: string; cards: FlashcardItem[] };

function tileCreatedAt(tile: FlashcardTile): string {
  if (tile.kind === 'single') return tile.card.createdAt;
  return tile.cards[0]?.createdAt ?? '';
}

function sortByPosition(cards: FlashcardItem[]): FlashcardItem[] {
  return [...cards].sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
}

/** One gallery tile per lone card, or per `sequenceId` with two or more cards. */
export function groupFlashcardTiles(cards: FlashcardItem[]): FlashcardTile[] {
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
    const ordered = sortByPosition(members);
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
