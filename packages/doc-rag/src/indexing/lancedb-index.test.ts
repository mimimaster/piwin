import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { IndexedChunk } from './doc-index-store.js';
import { openLanceDocIndex } from './lancedb-index.js';

function chunk(overrides: Partial<IndexedChunk> & Pick<IndexedChunk, 'chunkId' | 'documentId' | 'content'>): IndexedChunk {
  return {
    folderKey: 'folder',
    relativePath: 'a.md',
    contentHash: overrides.chunkId,
    sourceOrder: 0,
    tokenCount: 3,
    parserId: 'markdown-v1',
    parserVersion: '1',
    chunkerId: 'structure-recursive-v1',
    chunkerVersion: '1',
    ...overrides,
  };
}

describe('lancedb index', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('fts search is scoped to selected documents', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-lance-'));
    const store = await openLanceDocIndex(dir);
    await store.upsertChunks([
      chunk({
        chunkId: 'c1',
        documentId: 'doc-a',
        relativePath: 'a.md',
        content: 'Alpha topic about spaced repetition.',
      }),
      chunk({
        chunkId: 'c2',
        documentId: 'doc-b',
        relativePath: 'b.md',
        content: 'Alpha topic should not leak from beta.',
      }),
    ]);
    const hits = await store.ftsSearch({
      text: 'Alpha',
      folderKey: 'folder',
      documentIds: ['doc-a'],
      limit: 10,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.chunk.documentId === 'doc-a')).toBe(true);
    await store.close();
  });

  it('fts finds CJK with ICU tokenizer', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-lance-zh-'));
    const store = await openLanceDocIndex(dir);
    await store.upsertChunks([
      chunk({
        chunkId: 'zh1',
        documentId: 'doc-zh',
        relativePath: 'zh.md',
        content: '间隔重复按遗忘曲线安排复习时间。',
      }),
    ]);
    const hits = await store.ftsSearch({
      text: '间隔重复',
      folderKey: 'folder',
      documentIds: ['doc-zh'],
    });
    expect(hits.some((hit) => hit.chunk.chunkId === 'zh1')).toBe(true);
    await store.close();
  });
});
