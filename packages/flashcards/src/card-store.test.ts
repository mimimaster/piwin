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
});
