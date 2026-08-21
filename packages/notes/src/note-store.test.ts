import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNoteStore, type NoteStore } from './note-store.js';

let piwinRoot: string;
let store: NoteStore;

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-notes-'));
  store = createNoteStore({ piwinRoot });
});

afterEach(async () => {
  await rm(piwinRoot, { recursive: true, force: true });
});

describe('note-store', () => {
  it('writes and reads back a note with CJK content', async () => {
    const written = await store.write({
      title: '闪卡调度',
      content: '使用 FSRS 算法做间隔复习调度。',
      tags: ['学习', 'srs'],
    });
    const read = await store.read(written.id);
    expect(read.title).toBe('闪卡调度');
    expect(read.content).toBe('使用 FSRS 算法做间隔复习调度。');
    expect(read.tags).toEqual(['学习', 'srs']);
    expect(read.collection).toBe('default');
    expect(read.contentHash).toBe(written.contentHash);
  });

  it('updates content and bumps hash', async () => {
    const written = await store.write({ title: 'a', content: 'old' });
    const updated = await store.update({ id: written.id, content: 'new content' });
    expect(updated.content).toBe('new content');
    expect(updated.contentHash).not.toBe(written.contentHash);
    expect(updated.updatedAt >= written.updatedAt).toBe(true);
  });

  it('deletes a note', async () => {
    const written = await store.write({ title: 'gone', content: 'x' });
    await store.delete(written.id);
    await expect(store.read(written.id)).rejects.toThrow('note not found');
  });

  it('filters list by collection and tags', async () => {
    await store.write({ title: 'a', content: 'x', collection: 'work', tags: ['t1'] });
    await store.write({ title: 'b', content: 'y', collection: 'work', tags: ['t2'] });
    await store.write({ title: 'c', content: 'z' });
    expect(await store.list({ collection: 'work' })).toHaveLength(2);
    expect(await store.list({ collection: 'work', tags: ['t1'] })).toHaveLength(1);
    expect(await store.list()).toHaveLength(3);
  });

  it('rejects a stale update and leaves the other note untouched', async () => {
    const first = await store.write({ title: 'one', content: 'alpha' });
    const second = await store.write({ title: 'two', content: 'beta' });
    await store.update({
      id: first.id,
      content: 'alpha-2',
      expectedContentHash: first.contentHash,
    });
    const stale = store.update({
      id: first.id,
      content: 'lost',
      expectedContentHash: first.contentHash,
    });
    await expect(stale).rejects.toMatchObject({ name: 'NoteRevisionConflictError' });
    const latestFirst = await store.read(first.id);
    const latestSecond = await store.read(second.id);
    expect(latestFirst.content).toBe('alpha-2');
    expect(latestSecond.content).toBe('beta');
  });

  it('rejects a stale delete', async () => {
    const written = await store.write({ title: 'keep', content: 'body' });
    await expect(store.delete(written.id, 'not-the-hash')).rejects.toMatchObject({
      name: 'NoteRevisionConflictError',
    });
    await expect(store.read(written.id)).resolves.toMatchObject({ id: written.id });
  });

  it('rejects traversal in collection names', async () => {
    await expect(store.write({ title: 'x', content: 'y', collection: '../evil' })).rejects.toThrow(
      'path traversal',
    );
  });

  it('adopts external files without frontmatter with stable synthesized ids', async () => {
    const notesRoot = store.getNotesRoot();
    await mkdir(join(notesRoot, 'inbox'), { recursive: true });
    await writeFile(join(notesRoot, 'inbox', 'dropped.md'), '# 外部笔记\n没有 frontmatter', 'utf8');
    const all = await store.list();
    expect(all).toHaveLength(1);
    const first = all[0];
    if (!first) throw new Error('expected one note');
    expect(first.title).toBe('dropped');
    expect(first.collection).toBe('inbox');
    const again = await store.list();
    expect(again[0]?.id).toBe(first.id);
  });
});
