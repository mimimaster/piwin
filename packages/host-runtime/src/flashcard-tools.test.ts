import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCardStore, type CardStore } from '@piwin/flashcards';
import { buildFlashcardTools } from './flashcard-tools.js';

let piwinRoot: string;
let store: CardStore;

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-fc-tools-'));
  store = createCardStore({ piwinRoot });
});

afterEach(async () => {
  await rm(piwinRoot, { recursive: true, force: true });
});

describe('buildFlashcardTools', () => {
  it('returns empty when disabled', () => {
    expect(buildFlashcardTools({ store, enabled: false })).toEqual([]);
  });

  it('registers flashcard_create, flashcard_batch_create, flashcard_list, flashcard_delete', () => {
    const tools = buildFlashcardTools({ store, enabled: true });
    expect(tools.map((t) => t.name).sort()).toEqual([
      'flashcard_batch_create',
      'flashcard_create',
      'flashcard_delete',
      'flashcard_list',
    ]);
  });

  it('flashcard_create persists sourceFolder/sourceFile/sourceLine', async () => {
    const tools = buildFlashcardTools({ store, enabled: true });
    const create = tools.find((t) => t.name === 'flashcard_create')!;
    const raw = await create.execute({
      front: 'What is RAG?',
      back: 'Retrieval-Augmented Generation.',
      deck: 'ai',
      sourceFolder: '/docs',
      sourceFile: 'intro.md',
      sourceLine: 42,
      sourceExcerpt: 'RAG combines retrieval with generation.',
    });
    const result = JSON.parse(raw) as { card: { sourceFolder: string; sourceFile: string; sourceLine: number } };
    expect(result.card.sourceFolder).toBe('/docs');
    expect(result.card.sourceFile).toBe('intro.md');
    expect(result.card.sourceLine).toBe(42);
  });

  it('flashcard_batch_create creates multiple cards and returns artifactHtml', async () => {
    const tools = buildFlashcardTools({ store, enabled: true });
    const batch = tools.find((t) => t.name === 'flashcard_batch_create')!;
    const raw = await batch.execute({
      cards: [
        { front: 'q1', back: 'a1', deck: 'batch', sourceFolder: '/docs', sourceFile: 'f.md', sourceLine: 1 },
        { front: 'q2', back: 'a2', deck: 'batch', sourceFolder: '/docs', sourceFile: 'f.md', sourceLine: 5 },
      ],
    });
    const result = JSON.parse(raw) as { created: unknown[]; skipped: unknown[]; artifactHtml: string };
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.artifactHtml).toContain('piwin-flashcard-batch');
  });

  it('flashcard_batch_create skips duplicates (partial success)', async () => {
    await store.create({ front: 'dup', back: 'b', deck: 'd' });
    const tools = buildFlashcardTools({ store, enabled: true });
    const batch = tools.find((t) => t.name === 'flashcard_batch_create')!;
    const raw = await batch.execute({
      cards: [
        { front: 'dup', back: 'b', deck: 'd' },
        { front: 'unique', back: 'b', deck: 'd' },
      ],
    });
    const result = JSON.parse(raw) as { created: unknown[]; skipped: Array<{ reason: string }> };
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('duplicate');
  });

  it('flashcard_batch_create respects maxBatchSize', async () => {
    const tools = buildFlashcardTools({ store, enabled: true, maxBatchSize: 1 });
    const batch = tools.find((t) => t.name === 'flashcard_batch_create')!;
    await expect(
      batch.execute({
        cards: [
          { front: 'a', back: 'b' },
          { front: 'c', back: 'd' },
        ],
      }),
    ).rejects.toThrow('exceeds maxBatchSize');
  });

  it('flashcard_list filters by sourceFolder', async () => {
    await store.create({
      front: 'q1',
      back: 'a1',
      deck: 'd',
      sourceFolder: '/docs/x',
      sourceFile: 'f.md',
      sourceLine: 1,
    });
    await store.create({
      front: 'q2',
      back: 'a2',
      deck: 'd',
      sourceFolder: '/docs/y',
      sourceFile: 'f.md',
      sourceLine: 1,
    });
    const tools = buildFlashcardTools({ store, enabled: true });
    const list = tools.find((t) => t.name === 'flashcard_list')!;
    const raw = await list.execute({ sourceFolder: '/docs/x' });
    const cards = JSON.parse(raw) as Array<{ sourceFolder: string }>;
    expect(cards).toHaveLength(1);
    expect(cards[0]?.sourceFolder).toBe('/docs/x');
  });
});
