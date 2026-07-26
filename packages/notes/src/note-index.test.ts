import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNoteStore, type NoteStore } from './note-store.js';
import { openNoteIndex, type NoteIndex } from './note-index.js';
import { searchNotes } from './search-notes.js';
import { getIndexPath } from './paths.js';

let piwinRoot: string;
let store: NoteStore;
let index: NoteIndex;

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-notes-idx-'));
  store = createNoteStore({ piwinRoot });
  index = await openNoteIndex(store);
});

afterEach(async () => {
  index.close();
  await rm(piwinRoot, { recursive: true, force: true });
});

describe('note-index', () => {
  it('finds Chinese content via segmented FTS', async () => {
    await store.write({ title: '检索设计', content: '闪卡复习调度算法基于 FSRS。' });
    await store.write({ title: '无关', content: '今天天气不错。' });
    const hits = await searchNotes(index, { query: '复习 调度' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.note.title).toBe('检索设计');
    expect(hits[0]?.channels).toEqual(['fts']);
    expect(hits[0]?.rank.fts).toBe(1);
  });

  it('finds latin keywords case-insensitively', async () => {
    await store.write({ title: 'db', content: 'SQLite FTS5 with BM25 ranking' });
    const hits = await searchNotes(index, { query: 'sqlite bm25' });
    expect(hits).toHaveLength(1);
  });

  it('reconciles external edits (mtime/hash drift)', async () => {
    const note = await store.write({ title: 'target', content: '原始内容' });
    expect(await searchNotes(index, { query: '原始' })).toHaveLength(1);

    // Simulate vim edit: rewrite file directly, bypassing the store.
    const absolutePath = join(store.getNotesRoot(), note.relativePath);
    await writeFile(
      absolutePath,
      `---\nid: "${note.id}"\ntitle: "target"\ncreatedAt: "${note.createdAt}"\nupdatedAt: "${note.updatedAt}"\n---\n\n完全不同的正文\n`,
      'utf8',
    );

    expect(await searchNotes(index, { query: '原始' })).toHaveLength(0);
    const hits = await searchNotes(index, { query: '完全 不同' });
    expect(hits).toHaveLength(1);
  });

  it('purges deleted files from index', async () => {
    const note = await store.write({ title: 'temp', content: '待删除内容' });
    expect(await searchNotes(index, { query: '删除' })).toHaveLength(1);
    await unlink(join(store.getNotesRoot(), note.relativePath));
    expect(await searchNotes(index, { query: '删除' })).toHaveLength(0);
  });

  it('survives index file deletion with zero data loss (cache invariant)', async () => {
    await store.write({ title: 'a', content: '铁律测试内容' });
    expect(await searchNotes(index, { query: '铁律' })).toHaveLength(1);

    index.close();
    await unlink(getIndexPath(store.getNotesRoot()));

    index = await openNoteIndex(store);
    const hits = await searchNotes(index, { query: '铁律' });
    expect(hits).toHaveLength(1);
  });

  it('filters by collection', async () => {
    await store.write({ title: 'w', content: '相同关键词', collection: 'work' });
    await store.write({ title: 'p', content: '相同关键词', collection: 'personal' });
    const hits = await searchNotes(index, { query: '关键词', collection: 'work' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.note.collection).toBe('work');
  });

  it('returns empty for operator-only or empty queries', async () => {
    await store.write({ title: 'x', content: 'content' });
    expect(await searchNotes(index, { query: '!!!' })).toHaveLength(0);
    expect(await searchNotes(index, { query: '   ' })).toHaveLength(0);
  });

  it('neutralizes FTS5 operators in user queries', async () => {
    await store.write({ title: 'ops', content: 'not or near evil content' });
    // Would throw a syntax error if NOT/OR were passed raw to MATCH.
    const hits = await searchNotes(index, { query: 'NOT OR evil' });
    expect(hits).toHaveLength(1);
  });

  it('rebuild() recreates all rows', async () => {
    await store.write({ title: 'r', content: '重建测试' });
    await index.rebuild();
    expect(await searchNotes(index, { query: '重建' })).toHaveLength(1);
  });
});
