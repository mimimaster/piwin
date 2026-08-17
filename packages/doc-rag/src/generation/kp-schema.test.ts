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

  it('maps 1-based chunk indexes onto pack ids', () => {
    expect(
      parseRawKnowledgePoints(
        {
          knowledgePoints: [
            {
              concept: 'SRS',
              statement: 'A review schedule.',
              type: 'definition',
              importance: 0.8,
              sourceChunkIds: ['1'],
            },
          ],
        },
        pack,
      )[0]?.sourceChunkIds,
    ).toEqual(['chk-1']);
  });

  it('falls back to the first pack source when the model invents an id', () => {
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
      )[0]?.sourceChunkIds,
    ).toEqual(['chk-1']);
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

  it('maps high/medium labels and unknown types', () => {
    const parsed = parseRawKnowledgePoints(
      {
        knowledgePoints: [
          {
            concept: 'SRS',
            statement: 'A review schedule.',
            type: 'principle',
            importance: 'high',
            sourceChunkIds: ['chk-1'],
          },
          {
            concept: 'Rule',
            statement: 'Stay in the file.',
            type: 'rule',
            importance: 'low',
            sourceChunkIds: ['chk-1'],
          },
        ],
      },
      pack,
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ type: 'reason', importance: 0.9 });
    expect(parsed[1]).toMatchObject({ type: 'property', importance: 0.55 });
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
