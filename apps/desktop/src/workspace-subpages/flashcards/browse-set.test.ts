import { describe, expect, it } from 'vitest';
import type { FlashcardItem } from '@piwin/contracts';
import { browseStartIndex, cardsForBrowse } from './browse-set';

function card(overrides: Partial<FlashcardItem>): FlashcardItem {
  return {
    id: 'card-1',
    model: 'basic',
    deck: 'General',
    front: 'front',
    back: 'back',
    createdAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('cardsForBrowse', () => {
  it('returns the clicked card when it has no sequence', () => {
    const cards = [card({ id: 'a' }), card({ id: 'b' })];
    expect(cardsForBrowse(cards, 'b').map((item) => item.id)).toEqual(['b']);
  });

  it('returns the sequence in position order and start index of the clicked card', () => {
    const cards = [
      card({ id: 'solo' }),
      card({ id: 's2', sequenceId: 'seq', position: 2 }),
      card({ id: 's1', sequenceId: 'seq', position: 1 }),
      card({ id: 's3', sequenceId: 'seq', position: 3 }),
    ];
    const set = cardsForBrowse(cards, 's2');
    expect(set.map((item) => item.id)).toEqual(['s1', 's2', 's3']);
    expect(browseStartIndex(set, 's2')).toBe(1);
  });
});
