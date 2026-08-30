import { describe, expect, it } from 'vitest';
import type { FlashcardItem } from '@piwin/contracts';
import { expandItemToReviewCards, itemToDisplayCard } from './cloze.js';
import {
  buildScheduledEntries,
  buildSequenceEntries,
  captureSequenceMembers,
  groupFlashcardTiles,
  selectParentMembersPreservingOrder,
  sortSequenceMembers,
  tileMatchesQuery,
} from './study-sequence.js';

function item(partial: Partial<FlashcardItem> & { id: string }): FlashcardItem {
  return {
    model: 'basic',
    deck: 'General',
    front: partial.front ?? partial.id,
    back: partial.back ?? 'back',
    createdAt: partial.createdAt ?? '2026-08-01T00:00:00.000Z',
    ...partial,
  };
}

describe('sortSequenceMembers', () => {
  it('keeps already-ordered positions', () => {
    const ordered = sortSequenceMembers([
      item({ id: 'a', sequenceId: 'seq', position: 1 }),
      item({ id: 'b', sequenceId: 'seq', position: 2 }),
      item({ id: 'c', sequenceId: 'seq', position: 3 }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts shuffled input by position ascending', () => {
    const ordered = sortSequenceMembers([
      item({ id: 'c', sequenceId: 'seq', position: 3 }),
      item({ id: 'a', sequenceId: 'seq', position: 1 }),
      item({ id: 'b', sequenceId: 'seq', position: 2 }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks duplicate positions with createdAt then itemId', () => {
    const ordered = sortSequenceMembers([
      item({ id: 'b', sequenceId: 'seq', position: 1, createdAt: '2026-08-02T00:00:00.000Z' }),
      item({ id: 'a', sequenceId: 'seq', position: 1, createdAt: '2026-08-01T00:00:00.000Z' }),
      item({ id: 'd', sequenceId: 'seq', position: 1, createdAt: '2026-08-02T00:00:00.000Z' }),
      item({ id: 'c', sequenceId: 'seq', position: 1, createdAt: '2026-08-02T00:00:00.000Z' }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('places missing and invalid positions after valid ones, stably', () => {
    const ordered = sortSequenceMembers([
      item({ id: 'missing', sequenceId: 'seq', createdAt: '2026-08-01T00:00:00.000Z' }),
      item({ id: 'valid-2', sequenceId: 'seq', position: 2, createdAt: '2026-08-03T00:00:00.000Z' }),
      item({ id: 'zero', sequenceId: 'seq', position: 0, createdAt: '2026-08-01T00:00:00.000Z' }),
      item({ id: 'valid-1', sequenceId: 'seq', position: 1, createdAt: '2026-08-04T00:00:00.000Z' }),
      item({ id: 'nan', sequenceId: 'seq', position: Number.NaN, createdAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual([
      'valid-1',
      'valid-2',
      'missing',
      'nan',
      'zero',
    ]);
  });
});

describe('groupFlashcardTiles', () => {
  it('keeps cards without sequenceId as singles, newest first', () => {
    const tiles = groupFlashcardTiles([
      item({ id: 'a', createdAt: '2026-08-02T00:00:00.000Z' }),
      item({ id: 'b', createdAt: '2026-08-03T00:00:00.000Z' }),
    ]);
    expect(tiles.map((tile) => tile.kind)).toEqual(['single', 'single']);
    expect(tiles.map((tile) => tile.id)).toEqual(['b', 'a']);
  });

  it('treats a one-card sequence as a single tile', () => {
    const tiles = groupFlashcardTiles([
      item({ id: 'only', sequenceId: 'seq_lonely', position: 1 }),
    ]);
    expect(tiles).toEqual([expect.objectContaining({ kind: 'single', id: 'only' })]);
  });

  it('stacks two or more cards that share a sequenceId', () => {
    const tiles = groupFlashcardTiles([
      item({ id: 'c2', sequenceId: 'seq_1', position: 2, createdAt: '2026-08-04T00:00:00.000Z' }),
      item({ id: 'c1', sequenceId: 'seq_1', position: 1, createdAt: '2026-08-04T00:00:00.000Z' }),
      item({ id: 'solo', createdAt: '2026-08-05T00:00:00.000Z' }),
    ]);
    expect(tiles).toHaveLength(2);
    expect(tiles[0]?.kind).toBe('single');
    expect(tiles[1]).toMatchObject({ kind: 'set', sequenceId: 'seq_1' });
    if (tiles[1]?.kind === 'set') {
      expect(tiles[1].cards.map((card) => card.id)).toEqual(['c1', 'c2']);
    }
  });
});

describe('captureSequenceMembers', () => {
  it('excludes later-added cards from a captured snapshot', () => {
    const original = [
      item({ id: 'c1', sequenceId: 'seq_1', position: 1 }),
      item({ id: 'c2', sequenceId: 'seq_1', position: 2 }),
    ];
    const snapshot = captureSequenceMembers(original, 'seq_1');
    const later = [...original, item({ id: 'c3', sequenceId: 'seq_1', position: 3 })];
    expect(captureSequenceMembers(snapshot, 'seq_1').map((card) => card.id)).toEqual(['c1', 'c2']);
    expect(captureSequenceMembers(later, 'seq_1').map((card) => card.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('returns an empty list when there is no sequence', () => {
    expect(captureSequenceMembers([item({ id: 'solo' })], 'seq_1')).toEqual([]);
  });
});

describe('selectParentMembersPreservingOrder', () => {
  it('keeps parent relative order and rejects items outside the parent', () => {
    expect(selectParentMembersPreservingOrder(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual({
      ok: true,
      itemIds: ['a', 'c'],
    });
    expect(selectParentMembersPreservingOrder(['a', 'b'], ['a', 'z']).ok).toBe(false);
  });
});

describe('cloze expansion vs sequence entries', () => {
  const cloze = item({
    id: 'mito',
    model: 'cloze',
    text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
    sequenceId: 'seq_cloze',
    position: 1,
  });

  it('sequence studies one physical card; scheduled expands two independent holes', () => {
    const display = itemToDisplayCard(cloze);
    expect(display?.ordinal).toBe(0);
    expect(buildSequenceEntries([cloze], 'cv-1')).toHaveLength(1);

    const holes = expandItemToReviewCards(cloze);
    expect(holes.map((card) => card.ordinal)).toEqual([1, 2]);
    const scheduled = buildScheduledEntries(holes, new Map(), 'cv-1');
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((entry) => entry.ordinal)).toEqual([1, 2]);
    expect(scheduled[0]?.cardId).not.toBe(scheduled[1]?.cardId);
  });
});

describe('tileMatchesQuery', () => {
  it('matches front or back text', () => {
    const tile = groupFlashcardTiles([item({ id: 'x', front: 'KV Cache', back: 'attention' })])[0];
    expect(tile).toBeDefined();
    if (!tile) return;
    expect(tileMatchesQuery(tile, 'cache')).toBe(true);
    expect(tileMatchesQuery(tile, 'attention')).toBe(true);
    expect(tileMatchesQuery(tile, 'zzz')).toBe(false);
  });
});
