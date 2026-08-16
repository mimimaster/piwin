import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { createCardStore } from '@piwin/flashcards';
import { canonicalizeFolderPath, createFolderRag } from '@piwin/doc-rag';
import { handleKnowledgeCommand } from './knowledge-commands.js';
import { createDoccardsIngestionRegistry } from './doccards-job-commands.js';
import { createDoccardsGenerationRegistry } from './doccards-generation-jobs.js';
import type { KnowledgeCommandContext } from './knowledge-commands.js';

describe('doccards generation job', () => {
  let root: string;
  let folder: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  it('writes cards and never indexes from generate', async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-gen-root-'));
    folder = (await canonicalizeFolderPath(await mkdtemp(join(tmpdir(), 'piwin-gen-src-')))) ?? '';
    await writeFile(join(folder, 'srs.md'), '# SRS\n\nSpaced repetition fights forgetting.');
    const rag = createFolderRag({ piwinRoot: root });
    const indexFolder = vi.spyOn(rag, 'indexFolder');
    await rag.indexFolder(folder);
    const cardStore = createCardStore({ piwinRoot: root });
    const ctx: KnowledgeCommandContext = {
      getNotesServices: async () => {
        throw new Error('notes');
      },
      getCardStore: async () => cardStore,
      getFolderRag: async () => rag,
      loadConfig: async () => ({ hostMode: 'sdk', providers: [] }) as unknown as PiwinConfig,
      ingestionJobs: createDoccardsIngestionRegistry(),
      generationJobs: createDoccardsGenerationRegistry(),
      draftCards: async () => [
        {
          position: 1,
          front: 'What is spaced repetition?',
          back: 'A review schedule against forgetting.',
          cardType: 'definition',
          knowledgePointIds: [],
          sourceChunkIds: [],
        },
      ],
      piwinRoot: root,
    };

    indexFolder.mockClear();
    const started = await handleKnowledgeCommand(
      { type: 'doccards/generate', folderPath: folder, topic: 'spaced repetition' },
      'g1',
      ctx,
    );
    expect(started).toMatchObject({ success: true });
    await vi.waitFor(async () => {
      const status = await handleKnowledgeCommand(
        { type: 'doccards/generation-status', folderPath: folder },
        'g2',
        ctx,
      );
      expect(status).toMatchObject({
        success: true,
        data: { job: { status: 'COMPLETED' } },
      });
    });
    expect(indexFolder).toHaveBeenCalledTimes(0);
    const cards = await cardStore.list();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]?.sequenceId).toMatch(/^seq_gen_/);
    expect(cards[0]?.sourceFolder).toBe(folder);
    rag.close();
  });

  it('rejects generate when selected files are not READY', async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-gen-root-'));
    folder = (await canonicalizeFolderPath(await mkdtemp(join(tmpdir(), 'piwin-gen-src-')))) ?? '';
    await writeFile(join(folder, 'srs.md'), '# SRS\n\nSpaced repetition fights forgetting.');
    const rag = createFolderRag({ piwinRoot: root });
    const ctx: KnowledgeCommandContext = {
      getNotesServices: async () => {
        throw new Error('notes');
      },
      getCardStore: async () => createCardStore({ piwinRoot: root }),
      getFolderRag: async () => rag,
      loadConfig: async () => ({ hostMode: 'sdk', providers: [] }) as unknown as PiwinConfig,
      ingestionJobs: createDoccardsIngestionRegistry(),
      generationJobs: createDoccardsGenerationRegistry(),
      draftCards: async () => [],
      piwinRoot: root,
    };
    const started = await handleKnowledgeCommand(
      { type: 'doccards/generate', folderPath: folder, topic: 'srs' },
      'g0',
      ctx,
    );
    expect(started).toMatchObject({ success: false, error: 'INDEX_NOT_READY' });
    rag.close();
  });

  it('can generate again with a new sequenceId', async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-gen-root-'));
    folder = (await canonicalizeFolderPath(await mkdtemp(join(tmpdir(), 'piwin-gen-src-')))) ?? '';
    await writeFile(join(folder, 'srs.md'), '# SRS\n\nSpaced repetition fights forgetting.');
    const rag = createFolderRag({ piwinRoot: root });
    await rag.indexFolder(folder);
    const cardStore = createCardStore({ piwinRoot: root });
    let draft = 0;
    const ctx: KnowledgeCommandContext = {
      getNotesServices: async () => {
        throw new Error('notes');
      },
      getCardStore: async () => cardStore,
      getFolderRag: async () => rag,
      loadConfig: async () => ({ hostMode: 'sdk', providers: [] }) as unknown as PiwinConfig,
      ingestionJobs: createDoccardsIngestionRegistry(),
      generationJobs: createDoccardsGenerationRegistry(),
      draftCards: async (request) => {
        draft += 1;
        return [
          {
            position: 1,
            front: draft === 1 ? 'What is spaced repetition?' : 'Why space reviews?',
            back: draft === 1 ? 'A review schedule against forgetting.' : 'To fight forgetting.',
            cardType: 'definition',
            knowledgePointIds: [],
            sourceChunkIds: [],
          },
        ];
      },
      piwinRoot: root,
    };

    for (const requestId of ['g1', 'g3'] as const) {
      const started = await handleKnowledgeCommand(
        { type: 'doccards/generate', folderPath: folder, topic: 'spaced repetition' },
        requestId,
        ctx,
      );
      expect(started).toMatchObject({ success: true });
      await vi.waitFor(async () => {
        const status = await handleKnowledgeCommand(
          { type: 'doccards/generation-status', folderPath: folder },
          `${requestId}-s`,
          ctx,
        );
        expect(status).toMatchObject({
          success: true,
          data: { job: { status: 'COMPLETED' } },
        });
      });
    }

    const cards = await cardStore.list({ sourceFolder: folder });
    const sequences = new Set(cards.map((card) => card.sequenceId));
    expect(cards).toHaveLength(2);
    expect(sequences.size).toBe(2);
    rag.close();
  });

  it('uses workspaceName when topic is empty', async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-gen-root-'));
    folder = (await canonicalizeFolderPath(await mkdtemp(join(tmpdir(), 'piwin-gen-src-')))) ?? '';
    await writeFile(join(folder, 'srs.md'), '# SRS\n\nSpaced repetition fights forgetting.');
    const rag = createFolderRag({ piwinRoot: root });
    await rag.indexFolder(folder);
    vi.spyOn(rag, 'retrievePack').mockResolvedValue({
      query: 'workspace',
      folderKey: 'fk',
      retrievalMode: 'fts_only',
      degraded: true,
      sources: [
        {
          chunkId: 'chk-1',
          documentId: 'doc-1',
          relativePath: 'srs.md',
          text: 'Spaced repetition fights forgetting.',
          startLine: 1,
          endLine: 3,
          retrievedBy: 'fts',
        },
      ],
    });
    const seen: string[] = [];
    const ctx: KnowledgeCommandContext = {
      getNotesServices: async () => {
        throw new Error('notes');
      },
      getCardStore: async () => createCardStore({ piwinRoot: root }),
      getFolderRag: async () => rag,
      loadConfig: async () => ({ hostMode: 'sdk', providers: [] }) as unknown as PiwinConfig,
      ingestionJobs: createDoccardsIngestionRegistry(),
      generationJobs: createDoccardsGenerationRegistry(),
      draftCards: async (request) => {
        seen.push(request.topic);
        return [];
      },
      piwinRoot: root,
    };
    const started = await handleKnowledgeCommand(
      { type: 'doccards/generate', folderPath: folder },
      'g-empty',
      ctx,
    );
    expect(started).toMatchObject({ success: true });
    await vi.waitFor(async () => {
      const status = await handleKnowledgeCommand(
        { type: 'doccards/generation-status', folderPath: folder },
        'g-empty-s',
        ctx,
      );
      expect(status).toMatchObject({
        success: true,
        data: { job: { status: 'COMPLETED' } },
      });
    });
    expect(seen[0]).toBe(folder.split(/[\\/]/).pop());
    rag.close();
  });

  it('two-stage generate writes knowledgePointIds onto cards', async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-gen-root-'));
    folder = (await canonicalizeFolderPath(await mkdtemp(join(tmpdir(), 'piwin-gen-src-')))) ?? '';
    await writeFile(join(folder, 'srs.md'), '# SRS\n\nSpaced repetition fights forgetting.');
    const rag = createFolderRag({ piwinRoot: root });
    await rag.indexFolder(folder);
    const cardStore = createCardStore({ piwinRoot: root });
    const ctx: KnowledgeCommandContext = {
      getNotesServices: async () => {
        throw new Error('notes');
      },
      getCardStore: async () => cardStore,
      getFolderRag: async () => rag,
      loadConfig: async () => ({ hostMode: 'sdk', providers: [] }) as unknown as PiwinConfig,
      ingestionJobs: createDoccardsIngestionRegistry(),
      generationJobs: createDoccardsGenerationRegistry(),
      completeJson: async (request) => {
        if (request.schemaName === 'knowledge_points') {
          const packChunk = /\[chunk ([^\]]+)\]/.exec(request.userPrompt)?.[1] ?? 'missing';
          return {
            knowledgePoints: [
              {
                tempId: 't1',
                concept: 'SRS',
                statement: 'A review schedule.',
                type: 'definition',
                importance: 0.9,
                sourceChunkIds: [packChunk],
              },
            ],
          };
        }
        const kp = /\[(kp_[^\]]+)\]/.exec(request.userPrompt)?.[1] ?? 'kp_missing';
        const chunk = /\[chunk ([^\]]+)\]/.exec(request.userPrompt)?.[1] ?? 'missing';
        return {
          cards: [
            {
              front: 'What is SRS?',
              back: 'A review schedule.',
              cardType: 'definition',
              knowledgePointIds: [kp],
              sourceChunkIds: [chunk],
            },
          ],
        };
      },
      piwinRoot: root,
    };
    const started = await handleKnowledgeCommand(
      { type: 'doccards/generate', folderPath: folder, topic: 'spaced repetition' },
      'g-two',
      ctx,
    );
    expect(started).toMatchObject({ success: true });
    await vi.waitFor(async () => {
      const status = await handleKnowledgeCommand(
        { type: 'doccards/generation-status', folderPath: folder },
        'g-two-s',
        ctx,
      );
      expect(status).toMatchObject({ success: true, data: { job: { status: 'COMPLETED' } } });
    });
    const cards = await cardStore.list({ sourceFolder: folder });
    expect(cards[0]?.knowledgePointIds?.[0]).toMatch(/^kp_gen_/);
    expect(cards[0]?.sourceChunkIds?.length).toBeGreaterThan(0);
    rag.close();
  });
});
