import { describe, expect, it } from 'vitest';
import type { FlashcardItem, FlashcardReviewCard, ReviewState } from '@piwin/contracts';
import { createInitialReviewState } from './scheduler.js';
import { createStudyRound } from './study-round-reducer.js';
import { buildSequenceEntries } from './study-sequence.js';
import { buildStudyCatalogPage } from './study-catalog.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');

function item(partial: Partial<FlashcardItem> & { id: string }): FlashcardItem {
  return {
    model: 'basic',
    deck: partial.deck ?? 'General',
    front: partial.front ?? partial.id,
    back: partial.back ?? `SECRET-${partial.id}`,
    createdAt: partial.createdAt ?? '2026-08-01T00:00:00.000Z',
    ...partial,
  };
}

function reviewCard(card: FlashcardItem, due?: string): {
  card: FlashcardReviewCard;
  state: ReviewState;
} {
  const projected: FlashcardReviewCard = {
    cardId: card.id,
    itemId: card.id,
    model: 'basic',
    ordinal: 1,
    deck: card.deck,
    front: card.front ?? card.id,
    back: card.back ?? '',
    createdAt: card.createdAt,
  };
  const state = createInitialReviewState(card.id, NOW);
  if (due) {
    state.due = due;
    state.reps = 1;
  }
  return { card: projected, state };
}

describe('buildStudyCatalogPage', () => {
  it('projects safe summaries without answer bodies and paginates stably', () => {
    const items = [
      item({ id: 'a', front: 'Alpha question', createdAt: '2026-08-03T00:00:00.000Z' }),
      item({ id: 'b', front: 'Beta question', createdAt: '2026-08-02T00:00:00.000Z' }),
      item({ id: 'c', front: 'Gamma question', createdAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const first = buildStudyCatalogPage({ items, limit: 2, now: NOW });
    expect(first.tiles).toHaveLength(2);
    expect(first.tiles.map((tile) => tile.id)).toEqual(['a', 'b']);
    expect(first.nextCursor).toBe('b');
    for (const tile of first.tiles) {
      expect(tile.preview).not.toMatch(/SECRET/);
      expect(JSON.stringify(tile)).not.toMatch(/SECRET/);
    }

    const second = buildStudyCatalogPage({
      items,
      limit: 2,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
      now: NOW,
    });
    expect(second.tiles.map((tile) => tile.id)).toEqual(['c']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('filters by query and reports due / new counts without reshuffling sets', () => {
    const items = [
      item({
        id: 's1',
        sequenceId: 'seq-cache',
        position: 2,
        front: 'KV Cache 2',
        createdAt: '2026-08-04T00:00:00.000Z',
      }),
      item({
        id: 's2',
        sequenceId: 'seq-cache',
        position: 1,
        front: 'KV Cache 1',
        createdAt: '2026-08-04T00:00:00.000Z',
      }),
      item({ id: 'solo', front: 'Unrelated', createdAt: '2026-08-05T00:00:00.000Z' }),
    ];
    const due = reviewCard(items[2]!, '2026-08-29T00:00:00.000Z');
    const fresh = reviewCard(items[1]!);
    const page = buildStudyCatalogPage({
      items,
      query: 'cache',
      reviewCards: [due.card, fresh.card],
      states: new Map([
        [due.card.cardId, due.state],
        [fresh.card.cardId, fresh.state],
      ]),
      now: NOW,
    });
    expect(page.tiles).toHaveLength(1);
    expect(page.tiles[0]).toMatchObject({ kind: 'set', sequenceId: 'seq-cache', count: 2 });
    expect(page.dueCount).toBe(1);
    expect(page.newCount).toBe(1);
  });

  it('includes unfinished round summaries and deck-scoped due/new counts', () => {
    const items = [
      item({ id: 'd1', deck: 'srs', front: 'Deck one' }),
      item({ id: 'd2', deck: 'other', front: 'Deck two' }),
    ];
    const inDeck = reviewCard(items[0]!, '2026-08-29T00:00:00.000Z');
    const other = reviewCard(items[1]!, '2026-08-29T00:00:00.000Z');
    const round = createStudyRound({
      roundId: 'round-open',
      mode: 'sequence',
      scope: { kind: 'item', itemId: 'd1' },
      entries: buildSequenceEntries([items[0]!], 'cv-1'),
      controllerIdentity: 'conn-1',
      now: NOW.toISOString(),
    });
    const page = buildStudyCatalogPage({
      items,
      scopeFilter: { kind: 'deck', deck: 'srs' },
      reviewCards: [inDeck.card, other.card],
      states: new Map([
        [inDeck.card.cardId, inDeck.state],
        [other.card.cardId, other.state],
      ]),
      unfinishedRounds: [round],
      now: NOW,
    });
    expect(page.tiles.map((tile) => tile.id)).toEqual(['d1']);
    expect(page.dueCount).toBe(1);
    expect(page.newCount).toBe(0);
    expect(page.unfinishedRounds).toEqual([
      expect.objectContaining({ roundId: 'round-open', status: 'active' }),
    ]);
  });
});
