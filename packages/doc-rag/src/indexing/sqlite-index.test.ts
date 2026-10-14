import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocIndexStore, IndexedChunk } from './doc-index-store.js';
import { buildRecallMatchExpression, openSqliteDocIndex } from './sqlite-index.js';

function chunk(
  overrides: Partial<IndexedChunk> & Pick<IndexedChunk, 'chunkId' | 'documentId' | 'content'>,
): IndexedChunk {
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

describe('sqlite doc index', () => {
  let dir: string;
  let store: DocIndexStore | undefined;

  async function open(): Promise<DocIndexStore> {
    dir = await mkdtemp(join(tmpdir(), 'piwin-chunk-index-'));
    store = await openSqliteDocIndex(join(dir, 'chunk-index.sqlite3'));
    return store;
  }

  afterEach(async () => {
    await store?.close();
    store = undefined;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('fts search is scoped to the folder and the selected documents', async () => {
    const index = await open();
    await index.upsertChunks([
      chunk({ chunkId: 'c1', documentId: 'doc-a', content: 'Alpha topic about spaced repetition.' }),
      chunk({ chunkId: 'c2', documentId: 'doc-b', content: 'Alpha topic should not leak from beta.' }),
      chunk({
        chunkId: 'c3',
        documentId: 'doc-c',
        folderKey: 'other-folder',
        content: 'Alpha topic in a different folder.',
      }),
    ]);

    const scoped = await index.ftsSearch({ text: 'Alpha', folderKey: 'folder', documentIds: ['doc-a'] });
    expect(scoped.map((hit) => hit.chunk.chunkId)).toEqual(['c1']);
    expect(scoped[0]?.retrievedBy).toBe('fts');

    const wholeFolder = await index.ftsSearch({ text: 'Alpha', folderKey: 'folder' });
    expect(wholeFolder.map((hit) => hit.chunk.chunkId).sort()).toEqual(['c1', 'c2']);
  });

  it('finds CJK text by word', async () => {
    const index = await open();
    await index.upsertChunks([
      chunk({ chunkId: 'zh1', documentId: 'doc-zh', content: '间隔重复按遗忘曲线安排复习时间。' }),
      chunk({ chunkId: 'zh2', documentId: 'doc-zh2', content: '番茄工作法把时间切成二十五分钟。' }),
    ]);
    for (const text of ['间隔重复', '遗忘']) {
      const hits = await index.ftsSearch({ text, folderKey: 'folder' });
      expect(hits.map((hit) => hit.chunk.chunkId)).toEqual(['zh1']);
    }
  });

  it('matches a whole question on any of its words and ranks the best chunk first', async () => {
    const index = await open();
    await index.upsertChunks([
      chunk({ chunkId: 'best', documentId: 'd1', content: 'Spaced repetition schedules reviews along the forgetting curve.' }),
      chunk({ chunkId: 'weak', documentId: 'd2', content: 'The curve of the road bends left.' }),
      chunk({ chunkId: 'none', documentId: 'd3', content: 'Bread needs flour, water and salt.' }),
    ]);
    const hits = await index.ftsSearch({
      text: 'How does spaced repetition use the forgetting curve?',
      folderKey: 'folder',
    });
    expect(hits[0]?.chunk.chunkId).toBe('best');
    expect(hits.map((hit) => hit.chunk.chunkId)).not.toContain('none');
    expect(hits[0]?.score ?? 0).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it('treats FTS5 syntax in the query as plain words', async () => {
    const index = await open();
    await index.upsertChunks([chunk({ chunkId: 'c1', documentId: 'd1', content: 'alpha beta' })]);
    const hits = await index.ftsSearch({ text: 'alpha" OR NOT (beta*', folderKey: 'folder' });
    expect(hits.map((hit) => hit.chunk.chunkId)).toEqual(['c1']);
    expect(await index.ftsSearch({ text: '?!…', folderKey: 'folder' })).toEqual([]);
    expect(buildRecallMatchExpression('Alpha alpha beta')).toBe('"alpha" OR "beta"');
  });

  it('round-trips every chunk field and leaves the vector out of results', async () => {
    const index = await open();
    const stored = chunk({
      chunkId: 'm1',
      documentId: 'doc-m',
      relativePath: 'note.md',
      content: 'Tagged note body.',
      headingPath: ['Intro', 'Tags'],
      startLine: 3,
      endLine: 9,
      pageStart: 2,
      previousChunkId: 'm0',
      nextChunkId: 'm2',
      language: 'markdown',
      tokenCount: 42,
      parserVersion: '7',
      metadata: { title: 'Tagged', tags: ['a'] },
    });
    await index.upsertChunks([{ ...stored, vector: [1, 0, 0] }]);
    const hits = await index.ftsSearch({ text: 'Tagged', folderKey: 'folder' });
    expect(hits[0]?.chunk).toEqual(stored);
    expect(await index.getChunksByIds(['m1', 'missing'])).toEqual([stored]);
  });

  it('hybrid search surfaces a vector-only match and falls back to fts without a vector', async () => {
    const index = await open();
    await index.upsertChunks([
      chunk({ chunkId: 'text', documentId: 'd1', content: 'memory techniques overview', vector: [0, 1, 0] }),
      chunk({ chunkId: 'semantic', documentId: 'd2', content: 'completely different wording', vector: [1, 0, 0] }),
      chunk({ chunkId: 'both', documentId: 'd3', content: 'memory palace technique', vector: [0.9, 0.1, 0] }),
      chunk({ chunkId: 'other-dim', documentId: 'd4', content: 'unrelated', vector: [1, 0] }),
      chunk({ chunkId: 'unembedded', documentId: 'd5', content: 'unrelated as well' }),
    ]);

    const hybrid = await index.hybridSearch({ text: 'memory', vector: [1, 0, 0], folderKey: 'folder' });
    const ids = hybrid.map((hit) => hit.chunk.chunkId);
    expect(ids[0]).toBe('both');
    expect(ids).toContain('semantic');
    expect(ids).toContain('text');
    expect(ids).not.toContain('other-dim');
    expect(ids).not.toContain('unembedded');
    expect(hybrid.every((hit) => hit.retrievedBy === 'hybrid')).toBe(true);

    const scoped = await index.hybridSearch({
      text: 'memory',
      vector: [1, 0, 0],
      folderKey: 'folder',
      documentIds: ['d1'],
    });
    expect(scoped.map((hit) => hit.chunk.chunkId)).toEqual(['text']);

    const noVector = await index.hybridSearch({ text: 'memory', folderKey: 'folder' });
    expect(noVector.every((hit) => hit.retrievedBy === 'fts')).toBe(true);
    expect(noVector.map((hit) => hit.chunk.chunkId).sort()).toEqual(['both', 'text']);
  });

  it('replaces a document on upsert and forgets it on delete', async () => {
    const index = await open();
    await index.upsertChunks([
      chunk({ chunkId: 'a1', documentId: 'doc-a', content: 'first draft about otters' }),
      chunk({ chunkId: 'a2', documentId: 'doc-a', content: 'second paragraph about otters' }),
    ]);
    await index.upsertChunks([chunk({ chunkId: 'a1', documentId: 'doc-a', content: 'rewritten about badgers' })]);

    expect(await index.ftsSearch({ text: 'otters', folderKey: 'folder' })).toEqual([]);
    expect((await index.ftsSearch({ text: 'badgers', folderKey: 'folder' })).map((hit) => hit.chunk.chunkId)).toEqual(['a1']);
    expect(await index.getChunksByIds(['a2'])).toEqual([]);
    expect(await index.hasDocument('doc-a')).toBe(true);

    await index.deleteByDocumentId('doc-a');
    expect(await index.hasDocument('doc-a')).toBe(false);
    expect(await index.ftsSearch({ text: 'badgers', folderKey: 'folder' })).toEqual([]);
  });

  it('keeps chunks across reopen', async () => {
    const index = await open();
    await index.upsertChunks([chunk({ chunkId: 'p1', documentId: 'doc-p', content: 'persistent walrus' })]);
    await index.close();
    store = await openSqliteDocIndex(join(dir, 'chunk-index.sqlite3'));
    expect((await store.ftsSearch({ text: 'walrus', folderKey: 'folder' })).map((hit) => hit.chunk.chunkId)).toEqual(['p1']);
  });
});
