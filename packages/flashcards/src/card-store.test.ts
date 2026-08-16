import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCardStore, type CardStore } from './card-store.js';
import { getFlashcardsRoot } from './paths.js';

let piwinRoot: string;
let store: CardStore;

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-cards-'));
  store = createCardStore({ piwinRoot });
});

afterEach(async () => {
  await rm(piwinRoot, { recursive: true, force: true });
});

describe('card-store', () => {
  it('creates a card with initial review state, reads it back', async () => {
    const card = await store.create({
      front: '什么是间隔重复？',
      back: '按遗忘曲线安排复习时间的方法。',
      deck: 'srs',
      sourceNoteId: 'note-1',
      sourceExcerpt: '来源摘录',
      tags: ['学习'],
    });
    const read = await store.read(card.id);
    expect(read.front).toBe('什么是间隔重复？');
    expect(read.sourceNoteId).toBe('note-1');

    const state = await store.getReviewState(card.id);
    expect(state.reps).toBe(0);
    expect(new Date(state.due).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('rejects near-duplicate fronts within the same deck only', async () => {
    await store.create({ front: 'What is FSRS scheduling?', back: 'b', deck: 'd1' });
    await expect(
      store.create({ front: 'What is FSRS scheduling??', back: 'other', deck: 'd1' }),
    ).rejects.toThrow('near-duplicate');
    // Same front in a different deck is allowed.
    await expect(
      store.create({ front: 'What is FSRS scheduling?', back: 'b', deck: 'd2' }),
    ).resolves.toBeTruthy();
  });

  it('rate() persists FSRS progression across store instances', async () => {
    const card = await store.create({ front: 'f', back: 'b' });
    const rated = await store.rate(card.id, 'good');
    expect(rated.reps).toBe(1);

    // New store instance (fresh process simulation) sees the same state.
    const reopened = createCardStore({ piwinRoot });
    const state = await reopened.getReviewState(card.id);
    expect(state.reps).toBe(1);
    expect(state.due).toBe(rated.due);
  });

  it('review state is user data: deleting it re-initializes without crashing', async () => {
    const card = await store.create({ front: 'f2', back: 'b2' });
    await store.rate(card.id, 'good');
    const root = getFlashcardsRoot(piwinRoot);
    await unlink(join(root, 'review', `${card.id}.json`));
    const state = await store.getReviewState(card.id);
    expect(state.reps).toBe(0); // re-initialized as new
  });

  it('delete removes card and review state', async () => {
    const card = await store.create({ front: 'gone', back: 'b' });
    await store.delete(card.id);
    await expect(store.read(card.id)).rejects.toThrow('card not found');
    const states = await store.loadReviewStates();
    expect(states.has(card.id)).toBe(false);
  });

  it('rejects path traversal in card ids', async () => {
    await expect(store.read('../../etc/passwd')).rejects.toThrow('path traversal');
  });

  it('lists decks and filters by deck/source', async () => {
    await store.create({ front: 'a', back: 'b', deck: 'd1', sourceNoteId: 'n1' });
    await store.create({ front: 'c', back: 'd', deck: 'd2' });
    expect(await store.listDecks()).toEqual(['d1', 'd2']);
    expect(await store.list({ deck: 'd1' })).toHaveLength(1);
    expect(await store.list({ sourceNoteId: 'n1' })).toHaveLength(1);
  });

  it('persists and reads sourceFolder/sourceFile/sourceLine fields', async () => {
    const card = await store.create({
      front: 'What is RAG?',
      back: 'Retrieval-Augmented Generation.',
      deck: 'ai',
      sourceFolder: '/home/user/docs',
      sourceFile: 'intro.md',
      sourceLine: 42,
      sourceExcerpt: 'RAG combines retrieval with generation.',
    });
    const read = await store.read(card.id);
    expect(read.sourceFolder).toBe('/home/user/docs');
    expect(read.sourceFile).toBe('intro.md');
    expect(read.sourceLine).toBe(42);
    expect(read.sourceExcerpt).toBe('RAG combines retrieval with generation.');
  });

  it('persists sequence lineage fields and filters by sequenceId', async () => {
    const card = await store.create({
      front: 'What is a sequence?',
      back: 'A display order for generated cards.',
      deck: 'Notes',
      sourceFolder: '/docs/notes',
      sourceFile: 'a.md',
      sourceLine: 1,
      sequenceId: 'seq_a',
      position: 1,
      generationId: 'gen_a',
    });
    await store.create({
      front: 'Unrelated card',
      back: 'other',
      deck: 'Notes',
      sourceFolder: '/docs/notes',
      sourceFile: 'b.md',
      sourceLine: 1,
      sequenceId: 'seq_b',
      position: 1,
      generationId: 'gen_b',
    });
    const read = await store.read(card.id);
    expect(read.sequenceId).toBe('seq_a');
    expect(read.position).toBe(1);
    expect(read.generationId).toBe('gen_a');
    expect(await store.list({ sequenceId: 'seq_a' })).toHaveLength(1);
    expect((await store.list({ sequenceId: 'seq_a' }))[0]?.id).toBe(card.id);
  });

  it('allows the same front in two source folders', async () => {
    await store.create({
      front: 'What is FSRS scheduling?',
      back: 'b',
      deck: 'Notes',
      sourceFolder: '/a/Notes',
      sourceFile: 'a.md',
      sourceLine: 1,
    });
    await expect(
      store.create({
        front: 'What is FSRS scheduling?',
        back: 'b',
        deck: 'Notes',
        sourceFolder: '/b/Notes',
        sourceFile: 'a.md',
        sourceLine: 1,
      }),
    ).resolves.toBeTruthy();
  });

  it('list filters by sourceFolder', async () => {
    await store.create({
      front: 'q1',
      back: 'a1',
      deck: 'd',
      sourceFolder: '/docs/a',
      sourceFile: 'f1.md',
      sourceLine: 1,
    });
    await store.create({
      front: 'q2',
      back: 'a2',
      deck: 'd',
      sourceFolder: '/docs/b',
      sourceFile: 'f2.md',
      sourceLine: 1,
    });
    expect(await store.list({ sourceFolder: '/docs/a' })).toHaveLength(1);
    expect(await store.list({ sourceFolder: '/docs/b' })).toHaveLength(1);
    expect(await store.list({ sourceFolder: '/docs/c' })).toHaveLength(0);
  });

  it('batchCreate creates multiple cards and skips duplicates', async () => {
    await store.create({ front: 'existing', back: 'b', deck: 'batch' });
    const result = await store.batchCreate({
      cards: [
        { front: 'card1', back: 'b1', deck: 'batch' },
        { front: 'card2', back: 'b2', deck: 'batch' },
        { front: 'existing', back: 'dup', deck: 'batch' },
      ],
    });
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('duplicate');
  });

  it('batchCreate rejects empty array', async () => {
    await expect(store.batchCreate({ cards: [] })).rejects.toThrow('non-empty');
  });

  it('batchCreate rejects array exceeding maxBatchSize', async () => {
    await expect(
      store.batchCreate(
        {
          cards: [
            { front: 'a', back: 'b' },
            { front: 'c', back: 'd' },
          ],
        },
        1,
      ),
    ).rejects.toThrow('exceeds maxBatchSize');
  });

  it('deleteBySourceFolder removes all cards from that folder', async () => {
    await store.create({
      front: 'q1',
      back: 'a1',
      deck: 'd',
      sourceFolder: '/docs/x',
      sourceFile: 'f1.md',
      sourceLine: 1,
    });
    await store.create({
      front: 'q2',
      back: 'a2',
      deck: 'd',
      sourceFolder: '/docs/y',
      sourceFile: 'f2.md',
      sourceLine: 1,
    });
    const result = await store.deleteBySourceFolder('/docs/x');
    expect(result.deleted).toBe(1);
    expect(await store.list({ sourceFolder: '/docs/x' })).toHaveLength(0);
    expect(await store.list({ sourceFolder: '/docs/y' })).toHaveLength(1);
  });

  it('rebindSourceFolder updates sourceFolder on matching cards', async () => {
    await store.create({
      front: 'q1',
      back: 'a1',
      deck: 'd',
      sourceFolder: '/docs/old',
      sourceFile: 'f1.md',
      sourceLine: 1,
    });
    const result = await store.rebindSourceFolder('/docs/old', '/docs/new');
    expect(result.updated).toBe(1);
    expect(await store.list({ sourceFolder: '/docs/old' })).toHaveLength(0);
    expect(await store.list({ sourceFolder: '/docs/new' })).toHaveLength(1);
    const card = (await store.list({ sourceFolder: '/docs/new' }))[0];
    expect(card?.sourceFile).toBe('f1.md'); // preserved
    expect(card?.sourceLine).toBe(1); // preserved
  });
});
