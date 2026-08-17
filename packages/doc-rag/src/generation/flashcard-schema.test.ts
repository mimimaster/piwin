import { describe, expect, it } from 'vitest';
import type { ContextPack, KnowledgePoint } from '@piwin/contracts';
import { parseGeneratedFlashcards } from './flashcard-schema.js';
import { qaGeneratedFlashcards } from './flashcard-qa.js';

const pack: ContextPack = {
  query: 'srs',
  folderKey: 'fk',
  retrievalMode: 'fts_only',
  degraded: true,
  sources: [
    {
      chunkId: 'chk-1',
      documentId: 'doc-1',
      relativePath: 'srs.md',
      text: 'Spaced repetition schedules reviews.',
      retrievedBy: 'fts',
    },
  ],
};

const kps: KnowledgePoint[] = [
  {
    id: 'kp_gen_1_1',
    concept: 'SRS',
    statement: 'A review schedule.',
    type: 'definition',
    importance: 0.8,
    sourceChunkIds: ['chk-1'],
    sourceOrder: 0,
  },
];

describe('parseGeneratedFlashcards', () => {
  it('assigns positions and drops relationFromPrevious on the first card', () => {
    const cards = parseGeneratedFlashcards(
      {
        cards: [
          {
            front: 'What is SRS?',
            back: 'A review schedule.',
            cardType: 'definition',
            relationFromPrevious: 'should-go',
            knowledgePointIds: ['kp_gen_1_1'],
            sourceChunkIds: ['chk-1'],
          },
          {
            front: 'Why space reviews?',
            back: 'To fight forgetting.',
            cardType: 'reason',
            relationFromPrevious: 'builds-on',
            knowledgePointIds: ['kp_gen_1_1'],
            sourceChunkIds: ['chk-1'],
          },
        ],
      },
      pack,
      kps,
    );
    expect(cards[0]).toMatchObject({ position: 1, front: 'What is SRS?' });
    expect(cards[0]?.relationFromPrevious).toBeUndefined();
    expect(cards[1]?.relationFromPrevious).toBe('builds-on');
  });

  it('drops cards whose sources are not in the pack or KP', () => {
    expect(
      parseGeneratedFlashcards(
        {
          cards: [
            {
              front: 'Q',
              back: 'A',
              cardType: 'fact',
              knowledgePointIds: ['kp_gen_1_1'],
              sourceChunkIds: ['nope'],
            },
          ],
        },
        pack,
        kps,
      ),
    ).toHaveLength(1);
    expect(
      parseGeneratedFlashcards(
        {
          cards: [
            {
              front: 'Q',
              back: 'A',
              cardType: 'fact',
              knowledgePointIds: ['missing'],
              sourceChunkIds: ['nope'],
            },
          ],
        },
        pack,
        kps,
      )[0]?.sourceChunkIds,
    ).toEqual(['chk-1']);
  });
});

describe('qaGeneratedFlashcards', () => {
  it('renumbers positions and drops exact existing fronts', () => {
    const cards = qaGeneratedFlashcards({
      cards: [
        {
          position: 9,
          front: 'Old',
          back: 'A',
          cardType: 'fact',
          knowledgePointIds: ['kp_gen_1_1'],
          sourceChunkIds: ['chk-1'],
        },
        {
          position: 2,
          front: 'New',
          back: 'B',
          cardType: 'fact',
          knowledgePointIds: ['kp_gen_1_1'],
          sourceChunkIds: ['chk-1'],
        },
      ],
      pack,
      knowledgePoints: kps,
      existingFronts: ['Old'],
    });
    expect(cards).toEqual([
      expect.objectContaining({ position: 1, front: 'New' }),
    ]);
  });
});
