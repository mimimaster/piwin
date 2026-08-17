import { describe, expect, it } from 'vitest';
import type { ContextPack } from '@piwin/contracts';
import { fallbackPackSourceId, resolveSourceIds } from './resolve-source-ids.js';

const pack: ContextPack = {
  query: 'srs',
  folderKey: 'fk',
  retrievalMode: 'hybrid',
  degraded: false,
  sources: [
    {
      chunkId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      documentId: 'doc-1',
      relativePath: 'spaced-repetition.md',
      text: 'Spaced repetition fights forgetting.',
      retrievedBy: 'hybrid',
    },
    {
      chunkId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      documentId: 'doc-1',
      relativePath: 'spaced-repetition.md',
      text: 'The forgetting curve decays quickly.',
      retrievedBy: 'hybrid',
    },
  ],
};

describe('resolveSourceIds', () => {
  it('keeps exact chunk ids', () => {
    expect(resolveSourceIds([pack.sources[0]!.chunkId], pack)).toEqual([pack.sources[0]!.chunkId]);
  });

  it('maps 1-based chunk indexes and prefixes', () => {
    expect(resolveSourceIds(['1', 'chunk 2'], pack)).toEqual([
      pack.sources[0]!.chunkId,
      pack.sources[1]!.chunkId,
    ]);
    expect(resolveSourceIds(['aaaaaaaa'], pack)).toEqual([pack.sources[0]!.chunkId]);
  });

  it('maps a unique relative path', () => {
    const single: ContextPack = { ...pack, sources: [pack.sources[0]!] };
    expect(resolveSourceIds(['spaced-repetition.md'], single)).toEqual([single.sources[0]!.chunkId]);
  });

  it('drops invented ids', () => {
    expect(resolveSourceIds(['invented'], pack)).toEqual([]);
  });
});

describe('fallbackPackSourceId', () => {
  it('returns the first pack source', () => {
    expect(fallbackPackSourceId(pack)).toBe(pack.sources[0]!.chunkId);
  });
});
