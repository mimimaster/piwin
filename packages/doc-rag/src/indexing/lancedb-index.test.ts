import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as lancedb from '@lancedb/lancedb';
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

  it('round-trips chunk metadata through the table', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-lance-meta-'));
    const store = await openLanceDocIndex(dir);
    await store.upsertChunks([
      chunk({
        chunkId: 'm1',
        documentId: 'doc-m',
        relativePath: 'note.md',
        content: 'Tagged note body.',
        metadata: { title: 'Tagged', tags: ['a'] },
      }),
    ]);
    const hits = await store.ftsSearch({
      text: 'Tagged',
      folderKey: 'folder',
      documentIds: ['doc-m'],
    });
    expect(hits[0]?.chunk.metadata).toEqual({ title: 'Tagged', tags: ['a'] });
    await store.close();
  });

  it('adds metadata-bearing chunks to a table created before the metadata column existed', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-lance-legacy-'));
    // Simulate a table on disk from before this round: create it directly,
    // through the raw lancedb client, with a row shape that has no
    // `metadata` field at all (not even an empty one).
    const db = await lancedb.connect(dir);
    await db.createTable('doc_chunks_v2', [
      {
        chunk_id: 'old1',
        document_id: 'doc-old',
        folder_key: 'folder',
        relative_path: 'old.md',
        content: 'Pre-existing chunk from before metadata existed.',
        heading_path: '',
        source_order: 0,
        start_line: 0,
        end_line: 0,
        previous_chunk_id: '',
        next_chunk_id: '',
        content_hash: 'old1',
        language: '',
        parser_id: 'markdown-v1',
        chunker_id: 'structure-recursive-v1',
      },
    ]);

    const store = await openLanceDocIndex(dir);
    await store.upsertChunks([
      chunk({
        chunkId: 'new1',
        documentId: 'doc-new',
        relativePath: 'new.md',
        content: 'Freshly ingested chunk with metadata.',
        metadata: { title: 'New' },
      }),
    ]);
    const hits = await store.ftsSearch({
      text: 'Freshly',
      folderKey: 'folder',
      documentIds: ['doc-new'],
    });
    expect(hits[0]?.chunk.metadata).toEqual({ title: 'New' });
    const oldHits = await store.ftsSearch({
      text: 'Pre-existing',
      folderKey: 'folder',
      documentIds: ['doc-old'],
    });
    expect(oldHits[0]?.chunk.metadata).toBeUndefined();
    await store.close();
  });
});
