import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from './memory-store.js';
import { MEMORY_ORDINARY_LIMIT } from './constants.js';
import { MEMORY_OVERVIEW_HEADER } from './constants.js';

describe('createMemoryStore', () => {
  async function tempStore() {
    const root = await mkdtemp(join(tmpdir(), 'piwin-memory-'));
    return { root, store: createMemoryStore({ piwinRoot: root, ordinaryLimit: 3 }) };
  }

  it('writes reads lists and searches across sessions (same root)', async () => {
    const { root, store } = await tempStore();
    const written = await store.write({
      scope: 'global',
      type: 'user',
      title: 'Favorite editor',
      content: 'User prefers Cursor IDE for TypeScript.',
      confidence: 'high',
      quote: 'Cursor IDE',
      tags: ['editor'],
    });
    expect(written.id).toBeTruthy();
    expect(written.confidence).toBe('high');

    const storeB = createMemoryStore({ piwinRoot: root });
    const listed = await storeB.list({ scope: 'global' });
    expect(listed.some((item) => item.id === written.id)).toBe(true);
    const found = await storeB.read(written.id);
    expect(found.content).toContain('Cursor');
    const hits = await storeB.search({ query: 'Cursor TypeScript' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.record.id).toBe(written.id);
  });

  it('isolates project scopes', async () => {
    const { store } = await tempStore();
    await store.write({
      scope: 'project',
      projectKey: 'proj-a',
      type: 'project',
      content: 'secret-a only',
      title: 'A',
    });
    await store.write({
      scope: 'project',
      projectKey: 'proj-b',
      type: 'project',
      content: 'secret-b only',
      title: 'B',
    });
    const listA = await store.list({ scope: 'project', projectKey: 'proj-a' });
    const listB = await store.list({ scope: 'project', projectKey: 'proj-b' });
    expect(listA.every((item) => item.projectKey === 'proj-a')).toBe(true);
    expect(listB.every((item) => item.projectKey === 'proj-b')).toBe(true);
    expect(listA.some((item) => item.content.includes('secret-b'))).toBe(false);
  });

  it('enforces ordinary quota per scope', async () => {
    const { store } = await tempStore();
    await store.write({ scope: 'global', type: 'user', content: 'one' });
    await store.write({ scope: 'global', type: 'user', content: 'two' });
    await store.write({ scope: 'global', type: 'user', content: 'three' });
    await expect(
      store.write({ scope: 'global', type: 'user', content: 'four' }),
    ).rejects.toThrow(/quota exceeded/);
    // daily unlimited
    const daily = await store.write({ scope: 'global', type: 'daily', content: 'journal' });
    expect(daily.type).toBe('daily');
  });

  it('accepts and sets reviewed high confidence', async () => {
    const { store } = await tempStore();
    const written = await store.write({
      scope: 'global',
      type: 'feedback',
      content: 'needs review',
      confidence: 'high',
    });
    expect(written.confidence).toBe('medium');
    const accepted = await store.accept(written.id);
    expect(accepted.reviewedAt).toBeTruthy();
    expect(accepted.confidence).toBe('high');
  });

  it('deletes and updates', async () => {
    const { store } = await tempStore();
    const written = await store.write({
      scope: 'global',
      type: 'reference',
      content: 'old',
      title: 'T',
    });
    const updated = await store.update({ id: written.id, content: 'new', title: 'T2' });
    expect(updated.content).toBe('new');
    expect(updated.title).toBe('T2');
    await store.delete(written.id);
    await expect(store.read(written.id)).rejects.toThrow(/not found/);
  });

  it('builds overview with header and cache file', async () => {
    const { store } = await tempStore();
    await store.write({
      scope: 'global',
      type: 'user',
      title: 'Pref',
      content: 'dark mode',
      confidence: 'medium',
    });
    const text = await store.buildOverview();
    expect(text).toContain(MEMORY_OVERVIEW_HEADER);
    expect(text).toContain('Pref');
    const cached = await store.writeOverviewCache();
    const disk = await readFile(cached.cachePath, 'utf8');
    expect(disk).toContain(MEMORY_OVERVIEW_HEADER);
  });

  it('reports quota summary', async () => {
    const { store } = await tempStore();
    await store.write({ scope: 'global', type: 'user', content: 'a' });
    const summary = await store.quotaSummary({ scope: 'global' });
    expect(summary[0]?.ordinaryCount).toBe(1);
    expect(summary[0]?.ordinaryLimit).toBe(3);
  });

  it('default ordinary limit is 500', () => {
    expect(MEMORY_ORDINARY_LIMIT).toBe(500);
  });
});
