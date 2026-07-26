import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingProvider } from '@piwin/contracts';
import { createNoteStore, type NoteStore } from './note-store.js';
import { openNoteIndex, type NoteIndex } from './note-index.js';
import { searchNotes } from './search-notes.js';

let piwinRoot: string;
let store: NoteStore;
let index: NoteIndex;

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-hybrid-'));
  store = createNoteStore({ piwinRoot });
  index = await openNoteIndex(store);
});

afterEach(async () => {
  index.close();
  await rm(piwinRoot, { recursive: true, force: true });
});

/**
 * Deterministic fake: vector = keyword-presence one-hots. Lets us control
 * "semantic" similarity without a real model.
 */
function makeFakeProvider(keywords: string[]): EmbeddingProvider & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    id: 'fake',
    model: 'fake-model-v1',
    dimensions: keywords.length,
    calls,
    async embed(texts) {
      calls.push(texts);
      return texts.map((text) => {
        const vector = new Float32Array(keywords.length);
        for (const [position, keyword] of keywords.entries()) {
          if (text.toLowerCase().includes(keyword)) {
            vector[position] = 1;
          }
        }
        return vector;
      });
    },
  };
}

describe('searchNotes modes', () => {
  it('auto without provider = fts', async () => {
    await store.write({ title: 'a', content: '闪卡复习内容' });
    const hits = await searchNotes(index, { query: '复习' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.channels).toEqual(['fts']);
  });

  it('vector mode finds semantically-tagged note that FTS misses', async () => {
    await store.write({ title: 'srs', content: 'spaced repetition scheduling notes' });
    await store.write({ title: 'cooking', content: 'pasta recipe collection' });
    const provider = makeFakeProvider(['repetition', 'anki']);

    // Query "anki" shares no keyword with either doc via FTS, but the fake
    // gives docs containing "repetition" a vector; query "anki repetition"
    // overlaps on the repetition dimension.
    const hits = await searchNotes(
      index,
      { query: 'anki repetition', mode: 'vector' },
      { embeddingProvider: provider },
    );
    expect(hits[0]?.note.title).toBe('srs');
    expect(hits[0]?.channels).toEqual(['vector']);
    expect(hits[0]?.rank.vector).toBe(1);
  });

  it('auto with provider = hybrid; doc hit by both channels ranks first', async () => {
    await store.write({ title: 'target', content: 'repetition 复习 both channels' });
    await store.write({ title: 'fts-only', content: '复习 keyword only here' });
    await store.write({ title: 'vec-only', content: 'repetition without cjk keyword' });
    const provider = makeFakeProvider(['repetition']);

    const hits = await searchNotes(
      index,
      { query: 'repetition 复习' },
      { embeddingProvider: provider },
    );
    expect(hits[0]?.note.title).toBe('target');
    expect(hits[0]?.channels.sort()).toEqual(['fts', 'vector']);
    expect(hits.map((hit) => hit.note.title)).toContain('fts-only');
    expect(hits.map((hit) => hit.note.title)).toContain('vec-only');
  });

  it('caches embeddings: second search embeds only the query', async () => {
    await store.write({ title: 'a', content: 'repetition alpha' });
    await store.write({ title: 'b', content: 'repetition beta' });
    const provider = makeFakeProvider(['repetition']);

    await searchNotes(index, { query: 'repetition' }, { embeddingProvider: provider });
    const callsAfterFirst = provider.calls.length;
    await searchNotes(index, { query: 'repetition' }, { embeddingProvider: provider });
    // Exactly one more call (the query itself), no doc re-embedding.
    expect(provider.calls.length).toBe(callsAfterFirst + 1);
    expect(provider.calls.at(-1)).toEqual(['repetition']);
  });

  it('re-embeds a note after external content change', async () => {
    const note = await store.write({ title: 'a', content: 'repetition original' });
    const provider = makeFakeProvider(['repetition']);
    await searchNotes(index, { query: 'repetition' }, { embeddingProvider: provider });

    await store.update({ id: note.id, content: 'totally different now' });
    await searchNotes(index, { query: 'repetition' }, { embeddingProvider: provider });
    // Update dropped the vector row; a doc re-embed batch must have occurred.
    const docBatches = provider.calls.filter((batch) =>
      batch.some((text) => text.includes('totally different')),
    );
    expect(docBatches.length).toBeGreaterThan(0);
  });

  it('degrades to fts with warning when provider fails', async () => {
    await store.write({ title: 'a', content: '复习 fallback content' });
    const failing: EmbeddingProvider = {
      id: 'broken',
      model: 'broken-v1',
      dimensions: 2,
      async embed() {
        throw new Error('connection refused');
      },
    };
    const onWarning = vi.fn();
    const hits = await searchNotes(
      index,
      { query: '复习', mode: 'hybrid' },
      { embeddingProvider: failing, onWarning },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.channels).toEqual(['fts']);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('degraded to fts'));
  });

  it('vector/hybrid mode without provider silently serves fts', async () => {
    await store.write({ title: 'a', content: '复习 content' });
    const hits = await searchNotes(index, { query: '复习', mode: 'hybrid' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.channels).toEqual(['fts']);
  });

  it('rethrows on abort instead of degrading', async () => {
    await store.write({ title: 'a', content: 'content' });
    const controller = new AbortController();
    const aborting: EmbeddingProvider = {
      id: 'abort',
      model: 'abort-v1',
      dimensions: 1,
      async embed() {
        controller.abort();
        throw new Error('aborted');
      },
    };
    await expect(
      searchNotes(
        index,
        { query: 'content', mode: 'vector' },
        { embeddingProvider: aborting, signal: controller.signal },
      ),
    ).rejects.toThrow('aborted');
  });
});
