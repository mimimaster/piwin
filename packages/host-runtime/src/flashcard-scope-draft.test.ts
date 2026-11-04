import { describe, expect, it, vi } from 'vitest';
import type { ContextPack } from '@piwin/contracts';
import { draftFlashcardsFromScope, FlashcardScopeDraftError } from './flashcard-scope-draft.js';

function completeJson() {
  return async (request: { schemaName: string }) => {
    if (request.schemaName === 'knowledge_points') {
      return {
        knowledgePoints: [
          {
            tempId: 't1',
            concept: 'SRS',
            statement: 'A review schedule.',
            type: 'definition',
            importance: 0.9,
            sourceChunkIds: ['scope-1'],
          },
        ],
      };
    }
    return {
      cards: [
        {
          model: 'basic',
          front: 'What is SRS?',
          back: 'A review schedule.',
          cardType: 'definition',
          knowledgePointIds: ['kp_draft_1'],
          sourceChunkIds: ['scope-1'],
        },
        {
          model: 'cloze',
          text: 'SRS is {{c1::spaced repetition}}.',
          cardType: 'fact',
          knowledgePointIds: ['kp_draft_1'],
          sourceChunkIds: ['scope-1'],
        },
      ],
    };
  };
}

describe('draftFlashcardsFromScope', () => {
  it('builds selection drafts with wiki slug and does not need retrieval', async () => {
    const retrievePack = vi.fn();
    const result = await draftFlashcardsFromScope({
      scope: {
        kind: 'selection',
        text: 'Spaced repetition schedules reviews.',
        sourceFile: 'fsrs.md',
        sourceLine: 4,
        wikiSlug: 'fsrs-spaced-repetition',
        tags: ['memory', 'health'],
      },
      completeJson: completeJson(),
      existingFronts: [],
      retrievePack,
    });
    expect(retrievePack).not.toHaveBeenCalled();
    expect(result.counts).toEqual({ basic: 1, cloze: 1 });
    expect(result.drafts[0]).toMatchObject({
      wikiSlug: 'fsrs-spaced-repetition',
      tags: ['memory', 'health'],
      sourceFile: 'fsrs.md',
      sourceLine: 4,
      sourceHash: expect.any(String),
    });
  });

  it('retrieves only the listed files for a batch', async () => {
    const pack: ContextPack = {
      query: 'batch',
      folderKey: 'fk',
      retrievalMode: 'fts_only',
      degraded: false,
      sources: [
        {
          chunkId: 'scope-1',
          documentId: 'a',
          relativePath: 'a.md',
          text: 'alpha',
          retrievedBy: 'fts',
        },
      ],
    };
    const retrievePack = vi.fn(async () => pack);
    await draftFlashcardsFromScope({
      scope: {
        kind: 'files',
        folderPath: '/docs',
        relativePaths: ['a.md', 'b.md'],
        topic: 'memory',
      },
      completeJson: completeJson(),
      existingFronts: [],
      retrievePack,
    });
    expect(retrievePack).toHaveBeenCalledWith(
      '/docs',
      'memory',
      expect.objectContaining({ fileAllowlist: ['a.md', 'b.md'] }),
    );
  });

  it('refuses empty selection text', async () => {
    await expect(
      draftFlashcardsFromScope({
        scope: { kind: 'page', text: '  ' },
        completeJson: completeJson(),
        existingFronts: [],
      }),
    ).rejects.toBeInstanceOf(FlashcardScopeDraftError);
  });
});
