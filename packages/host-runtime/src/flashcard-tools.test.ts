import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostToolRegistration, ToolResult } from '@piwin/contracts';
import { createCardStore, type CardStore } from '@piwin/flashcards';
import { buildFlashcardTools } from './flashcard-tools.js';

let piwinRoot: string;
let store: CardStore;

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

function outputOf(result: ToolResult): string {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.output;
}

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
    expect(tools.map((t) => t.descriptor.name).sort()).toEqual([
      'flashcard_batch_create',
      'flashcard_create',
      'flashcard_delete',
      'flashcard_list',
    ]);
  });

  it('flashcard_create persists sourceFolder/sourceFile/sourceLine', async () => {
    const tools = buildFlashcardTools({ store, enabled: true });
    const create = tools.find((t) => t.descriptor.name === 'flashcard_create');
    if (!create) throw new Error('flashcard_create missing');
    const raw = outputOf(
      await executeTool(create, {
        front: 'What is RAG?',
        back: 'Retrieval-Augmented Generation.',
        deck: 'ai',
        sourceFolder: '/docs',
        sourceFile: 'intro.md',
        sourceLine: 42,
        sourceExcerpt: 'RAG combines retrieval with generation.',
      }),
    );
    const result = JSON.parse(raw) as {
      card: { sourceFolder: string; sourceFile: string; sourceLine: number };
    };
    expect(result.card.sourceFolder).toBe('/docs');
    expect(result.card.sourceFile).toBe('intro.md');
    expect(result.card.sourceLine).toBe(42);
  });

  it('flashcard_batch_create creates multiple cards and returns artifactHtml', async () => {
    const tools = buildFlashcardTools({ store, enabled: true });
    const batch = tools.find((t) => t.descriptor.name === 'flashcard_batch_create');
    if (!batch) throw new Error('flashcard_batch_create missing');
    const raw = outputOf(
      await executeTool(batch, {
        cards: [
          {
            front: 'q1',
            back: 'a1',
            deck: 'batch',
            sourceFolder: '/docs',
            sourceFile: 'f.md',
            sourceLine: 1,
          },
          {
            front: 'q2',
            back: 'a2',
            deck: 'batch',
            sourceFolder: '/docs',
            sourceFile: 'f.md',
            sourceLine: 5,
          },
        ],
      }),
    );
    const result = JSON.parse(raw) as {
      created: unknown[];
      skipped: unknown[];
      artifactHtml: string;
    };
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.artifactHtml).toContain('piwin-flashcard-batch');
  });

  it('flashcard_batch_create skips duplicates (partial success)', async () => {
    await store.create({ front: 'dup', back: 'b', deck: 'd' });
    const tools = buildFlashcardTools({ store, enabled: true });
    const batch = tools.find((t) => t.descriptor.name === 'flashcard_batch_create');
    if (!batch) throw new Error('flashcard_batch_create missing');
    const raw = outputOf(
      await executeTool(batch, {
        cards: [
          { front: 'dup', back: 'b', deck: 'd' },
          { front: 'unique', back: 'b', deck: 'd' },
        ],
      }),
    );
    const result = JSON.parse(raw) as {
      created: unknown[];
      skipped: Array<{ reason: string; existing?: { id: string; front?: string } }>;
      artifactHtml?: string;
    };
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('duplicate');
    expect(result.skipped[0]?.existing?.front).toBe('dup');
    expect(result.artifactHtml).toContain('dup');
    expect(result.artifactHtml).toContain('unique');
  });

  it('flashcard_create returns the existing card when the text is a duplicate', async () => {
    const first = await store.create({
      model: 'cloze',
      text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
      deck: 'bio',
    });
    const tools = buildFlashcardTools({ store, enabled: true });
    const create = tools.find((t) => t.descriptor.name === 'flashcard_create');
    if (!create) throw new Error('flashcard_create missing');
    const raw = outputOf(
      await executeTool(create, {
        model: 'cloze',
        text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
        deck: 'bio',
      }),
    );
    const result = JSON.parse(raw) as {
      card: { id: string };
      duplicate: boolean;
      artifactHtml: string;
    };
    expect(result.duplicate).toBe(true);
    expect(result.card.id).toBe(first.id);
    expect(result.artifactHtml).toContain('[…]');
  });

  it('flashcard_batch_create respects maxBatchSize', async () => {
    const tools = buildFlashcardTools({ store, enabled: true, maxBatchSize: 1 });
    const batch = tools.find((t) => t.descriptor.name === 'flashcard_batch_create');
    if (!batch) throw new Error('flashcard_batch_create missing');
    await expect(
      executeTool(batch, {
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
    const list = tools.find((t) => t.descriptor.name === 'flashcard_list');
    if (!list) throw new Error('flashcard_list missing');
    const raw = outputOf(await executeTool(list, { sourceFolder: '/docs/x' }));
    const cards = JSON.parse(raw) as Array<{ sourceFolder: string }>;
    expect(cards).toHaveLength(1);
    expect(cards[0]?.sourceFolder).toBe('/docs/x');
  });

  it('flashcard_create accepts cloze text and lists it as one item', async () => {
    const tools = buildFlashcardTools({ store, enabled: true });
    const create = tools.find((t) => t.descriptor.name === 'flashcard_create');
    const list = tools.find((t) => t.descriptor.name === 'flashcard_list');
    if (!create || !list) throw new Error('tools missing');
    const createdRaw = outputOf(
      await executeTool(create, {
        model: 'cloze',
        text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
        deck: 'bio',
      }),
    );
    const created = JSON.parse(createdRaw) as { card: { id: string; model: string }; artifactHtml: string };
    expect(created.card.model).toBe('cloze');
    expect(created.artifactHtml).toContain("cardId: '" + created.card.id + "'");
    expect(created.artifactHtml).not.toContain("cardId: '" + created.card.id + ":c1'");
    expect(created.artifactHtml).not.toContain("cardId: '" + created.card.id + ":c2'");
    expect(created.artifactHtml).toContain('[…]');

    const listed = JSON.parse(outputOf(await executeTool(list, { deck: 'bio' }))) as Array<{
      id: string;
      model: string;
      front: string;
    }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.model).toBe('cloze');
    expect(listed[0]?.front).toBe('线粒体是细胞的能量工厂。');
    expect(listed[0]?.front).not.toContain('{{c1');
  });

  it('flashcard_delete strips a cloze cardId suffix', async () => {
    const item = await store.create({
      model: 'cloze',
      text: '{{c1::A}} and {{c2::B}}',
    });
    const tools = buildFlashcardTools({ store, enabled: true });
    const del = tools.find((t) => t.descriptor.name === 'flashcard_delete');
    if (!del) throw new Error('flashcard_delete missing');
    const raw = outputOf(await executeTool(del, { cardId: `${item.id}:c2` }));
    const result = JSON.parse(raw) as { deleted: boolean; id: string };
    expect(result.deleted).toBe(true);
    expect(result.id).toBe(item.id);
    await expect(store.read(item.id)).rejects.toThrow('card not found');
  });
});
