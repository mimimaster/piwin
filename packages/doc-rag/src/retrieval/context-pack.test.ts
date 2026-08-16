import { describe, expect, it } from 'vitest';
import type { ContextPackSource } from '@piwin/contracts';
import type { IndexedChunk, RetrievalHit } from '../indexing/doc-index-store.js';
import { assembleContextPack } from './context-pack.js';
import { expandNeighbors } from './neighbor-expander.js';

function chunk(id: string, documentId: string, extras: Partial<IndexedChunk> = {}): IndexedChunk {
  return {
    chunkId: id,
    documentId,
    folderKey: 'f',
    relativePath: `${documentId}.md`,
    content: extras.content ?? `${id} body`,
    contentHash: id,
    sourceOrder: 0,
    tokenCount: 1,
    parserId: 'markdown-v1',
    parserVersion: '1',
    chunkerId: 'structure-recursive-v1',
    chunkerVersion: '1',
    ...extras,
  };
}

describe('expandNeighbors', () => {
  it('does not attach a neighbor from another document', () => {
    const hit: RetrievalHit = {
      chunk: chunk('a1', 'doc-a', { nextChunkId: 'b1' }),
      score: 1,
      retrievedBy: 'fts',
    };
    const sources = expandNeighbors({
      hits: [hit],
      byId: new Map([
        ['a1', hit.chunk],
        ['b1', chunk('b1', 'doc-b')],
      ]),
    });
    expect(sources.map((source) => source.chunkId)).toEqual(['a1']);
  });
});

describe('assembleContextPack', () => {
  it('drops neighbor sources before anchors when over budget', () => {
    const neighbor: ContextPackSource = {
      chunkId: 'n1',
      documentId: 'd',
      relativePath: 'a.md',
      text: 'neighbor '.repeat(2000),
      retrievedBy: 'neighbor',
    };
    const anchor: ContextPackSource = {
      chunkId: 'a1',
      documentId: 'd',
      relativePath: 'a.md',
      text: 'anchor',
      retrievalScore: 1,
      retrievedBy: 'fts',
    };
    const pack = assembleContextPack({
      query: 'q',
      folderKey: 'f',
      retrievalMode: 'fts_only',
      degraded: true,
      sources: [anchor, neighbor],
      maxTokens: 20,
    });
    expect(pack.sources.map((source) => source.chunkId)).toEqual(['a1']);
  });
});
