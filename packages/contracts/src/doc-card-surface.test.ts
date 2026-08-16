import { describe, expect, it } from 'vitest';
import type { FlashcardRecord } from './flashcards.js';
import { buildDocCardSurface } from './doc-card-surface.js';

function card(overrides: Partial<FlashcardRecord>): FlashcardRecord {
  return {
    id: 'card-1',
    deck: 'Notes',
    front: 'What is SRS?',
    back: 'A review schedule.',
    createdAt: '2026-08-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildDocCardSurface', () => {
  it('fills the fixed slots and skips empty fronts', () => {
    const surface = buildDocCardSurface({
      workspaceName: 'Notes',
      cards: [
        card({ id: 'a', sourceFile: 'srs.md', sourceLine: 3, sourceFolder: '/docs' }),
        card({ id: 'skip', front: '   ' }),
        card({ id: 'b', front: 'Why space reviews?', back: 'Why space reviews?'.replace('Why', 'To') }),
      ],
    });
    expect(surface.cards).toHaveLength(2);
    expect(surface.cards[0]).toMatchObject({
      id: 'a',
      workspaceName: 'Notes',
      position: 1,
      total: 2,
      front: 'What is SRS?',
      sourceLabel: 'srs.md:3',
      canOpenSource: true,
    });
    expect(surface.cards[1]?.position).toBe(2);
    expect(surface.cards[1]?.canOpenSource).toBe(false);
  });
});
