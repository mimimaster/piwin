import { describe, expect, it } from 'vitest';
import type { ContextPack } from '@piwin/contracts';
import { runTwoStageGeneration, TWO_STAGE_PIPELINE } from './generation-pipeline.js';

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

describe('runTwoStageGeneration', () => {
  it('extracts KPs then ordered cards with lineage', async () => {
    const calls: string[] = [];
    const result = await runTwoStageGeneration({
      topic: 'srs',
      workspaceName: 'Notes',
      pack,
      existingFronts: [],
      generationId: 'gen_1',
      completeJson: async (request) => {
        calls.push(request.schemaName);
        if (request.schemaName === 'knowledge_points') {
          expect(request.userPrompt).not.toContain('flashcard:quality');
          return {
            knowledgePoints: [
              {
                tempId: 't1',
                concept: 'SRS',
                statement: 'A review schedule.',
                type: 'definition',
                importance: 0.9,
                sourceChunkIds: ['chk-1'],
              },
            ],
          };
        }
        expect(request.userPrompt).toContain('FLASHCARD_QUALITY_RULES'.slice(0, 0) + 'atomic');
        return {
          cards: [
            {
              front: 'What is SRS?',
              back: 'A review schedule.',
              cardType: 'definition',
              knowledgePointIds: ['kp_gen_1_1'],
              sourceChunkIds: ['chk-1'],
            },
          ],
        };
      },
    });
    expect(calls).toEqual(['knowledge_points', 'flashcards']);
    expect(result.pipelineVersion).toBe(TWO_STAGE_PIPELINE);
    expect(result.knowledgePoints[0]?.id).toBe('kp_gen_1_1');
    expect(result.cards[0]).toMatchObject({
      position: 1,
      front: 'What is SRS?',
      knowledgePointIds: ['kp_gen_1_1'],
      sourceChunkIds: ['chk-1'],
    });
  });

  it('repairs once then fails when both stages stay empty', async () => {
    let attempts = 0;
    await expect(
      runTwoStageGeneration({
        topic: 'srs',
        workspaceName: 'Notes',
        pack,
        existingFronts: [],
        generationId: 'gen_1',
        completeJson: async () => {
          attempts += 1;
          return { knowledgePoints: [] };
        },
      }),
    ).rejects.toThrow('NO_VALID_FLASHCARDS');
    expect(attempts).toBe(2);
  });
});
