import { describe, expect, it } from 'vitest';
import type { FlashcardItem } from '@piwin/contracts';
import { groupFlashcardTiles, tileMatchesQuery } from './group-flashcard-tiles';

function card(partial: Partial<FlashcardItem> & { id: string }): FlashcardItem {
  return {
    model: 'basic',
    deck: 'General',
    front: partial.front ?? partial.id,
    back: partial.back ?? 'back',
    createdAt: partial.createdAt ?? '2026-08-01T00:00:00Z',
    ...partial,
  };
}

describe('groupFlashcardTiles', () => {
  it('keeps cards without sequenceId as singles', () => {
    const tiles = groupFlashcardTiles([
      card({ id: 'a', createdAt: '2026-08-02T00:00:00Z' }),
      card({ id: 'b', createdAt: '2026-08-03T00:00:00Z' }),
    ]);
    expect(tiles.map((tile) => tile.kind)).toEqual(['single', 'single']);
    expect(tiles.map((tile) => tile.id)).toEqual(['b', 'a']);
  });

  it('stacks two or more cards that share a sequenceId, ordered by position', () => {
    const tiles = groupFlashcardTiles([
      card({ id: 'c2', sequenceId: 'seq_1', position: 2, createdAt: '2026-08-04T00:00:00Z' }),
      card({ id: 'c1', sequenceId: 'seq_1', position: 1, createdAt: '2026-08-04T00:00:00Z' }),
      card({ id: 'solo', createdAt: '2026-08-05T00:00:00Z' }),
    ]);
    expect(tiles).toHaveLength(2);
    expect(tiles[0]?.kind).toBe('single');
    expect(tiles[1]).toMatchObject({ kind: 'set', sequenceId: 'seq_1' });
    if (tiles[1]?.kind === 'set') {
      expect(tiles[1].cards.map((item) => item.id)).toEqual(['c1', 'c2']);
    }
  });

  it('treats a one-card sequence as a single tile', () => {
    const tiles = groupFlashcardTiles([card({ id: 'only', sequenceId: 'seq_lonely', position: 1 })]);
    expect(tiles).toEqual([
      expect.objectContaining({ kind: 'single', id: 'only' }),
    ]);
  });
});

describe('tileMatchesQuery', () => {
  it('matches front or back text', () => {
    const tile = groupFlashcardTiles([card({ id: 'x', front: 'KV Cache', back: 'attention' })])[0];
    expect(tile).toBeDefined();
    if (!tile) return;
    expect(tileMatchesQuery(tile, 'cache')).toBe(true);
    expect(tileMatchesQuery(tile, 'attention')).toBe(true);
    expect(tileMatchesQuery(tile, 'zzz')).toBe(false);
  });
});
