import { describe, expect, it } from 'vitest';
import type { ContextPack, RawKnowledgePoint } from '@piwin/contracts';
import { postprocessKnowledgePoints } from './kp-postprocess.js';

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
      text: 'A',
      retrievedBy: 'fts',
    },
    {
      chunkId: 'chk-2',
      documentId: 'doc-1',
      relativePath: 'srs.md',
      text: 'B',
      retrievedBy: 'fts',
    },
  ],
};

function raw(overrides: Partial<RawKnowledgePoint> = {}): RawKnowledgePoint {
  return {
    tempId: 't1',
    concept: 'Spaced repetition',
    statement: 'Reviews are scheduled.',
    type: 'definition',
    importance: 0.8,
    sourceChunkIds: ['chk-2'],
    ...overrides,
  };
}

describe('postprocessKnowledgePoints', () => {
  it('assigns canonical ids and sourceOrder from the pack', async () => {
    const [kp] = await postprocessKnowledgePoints({
      raw: [raw()],
      pack,
      generationId: 'gen_1',
    });
    expect(kp?.id).toBe('kp_gen_1_1');
    expect(kp?.sourceOrder).toBe(1);
  });

  it('drops exact duplicates and low importance', async () => {
    const kps = await postprocessKnowledgePoints({
      raw: [
        raw({ importance: 0.2 }),
        raw({ concept: '  Spaced   repetition ', statement: 'Reviews are scheduled.' }),
        raw({ concept: 'Spaced repetition', statement: 'Reviews are scheduled.' }),
      ],
      pack,
      generationId: 'gen_1',
    });
    expect(kps).toHaveLength(1);
  });

  it('drops near-duplicates when embeddings are similar', async () => {
    const kps = await postprocessKnowledgePoints({
      raw: [
        raw({ concept: 'A', statement: 'one' }),
        raw({ tempId: 't2', concept: 'B', statement: 'two' }),
      ],
      pack,
      generationId: 'gen_1',
      embedding: {
        providerId: 't',
        modelId: 'm',
        embedDocuments: async () => [
          [1, 0],
          [0.99, 0.01],
        ],
        embedQuery: async () => [1, 0],
      },
    });
    expect(kps).toHaveLength(1);
  });
});
