import { describe, expect, it } from 'vitest';
import type { ContextPack } from '@piwin/contracts';
import { parseRawKnowledgePoints } from './kp-schema.js';

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

describe('parseRawKnowledgePoints', () => {
  it('keeps a well-formed knowledge point', () => {
    expect(
      parseRawKnowledgePoints(
        {
          knowledgePoints: [
            {
              tempId: 't1',
              concept: 'SRS',
              statement: 'A review schedule.',
              type: 'definition',
              importance: 0.8,
              sourceChunkIds: ['chk-1'],
            },
          ],
        },
        pack,
      ),
    ).toHaveLength(1);
  });

  it('drops fake source ids', () => {
    expect(
      parseRawKnowledgePoints(
        {
          knowledgePoints: [
            {
              concept: 'SRS',
              statement: 'A review schedule.',
              type: 'definition',
              importance: 0.8,
              sourceChunkIds: ['invented'],
            },
          ],
        },
        pack,
      ),
    ).toEqual([]);
  });

  it('drops an empty concept', () => {
    expect(
      parseRawKnowledgePoints(
        {
          knowledgePoints: [
            {
              concept: '  ',
              statement: 'A review schedule.',
              type: 'definition',
              importance: 0.8,
              sourceChunkIds: ['chk-1'],
            },
          ],
        },
        pack,
      ),
    ).toEqual([]);
  });

  it('drops importance outside 0..1', () => {
    expect(
      parseRawKnowledgePoints(
        {
          knowledgePoints: [
            {
              concept: 'SRS',
              statement: 'A review schedule.',
              type: 'definition',
              importance: 1.4,
              sourceChunkIds: ['chk-1'],
            },
          ],
        },
        pack,
      ),
    ).toEqual([]);
  });
});
