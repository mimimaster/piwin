import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderRag } from '@piwin/doc-rag';
import { handleKnowledgeCommand } from './knowledge-commands.js';
import { createDoccardsIngestionRegistry } from './doccards-job-commands.js';
import type { KnowledgeCommandContext } from './knowledge-commands.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('doccards ingestion job shell', () => {
  let folder: string;

  afterEach(async () => {
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  it('index-folder returns jobId without waiting for indexFolder to finish', async () => {
    folder = await mkdtemp(join(tmpdir(), 'piwin-ing-'));
    await writeFile(join(folder, 'a.md'), '# A');
    const gate = deferred<void>();
    const indexFolder = vi.fn(async () => {
      await gate.promise;
      return { indexed: 1, chunks: 1, degraded: true, skipped: 0, warnings: [] };
    });
    const rag = { indexFolder, listDocuments: vi.fn(async () => []) } as unknown as FolderRag;
    const ingestionJobs = createDoccardsIngestionRegistry();
    const ctx: KnowledgeCommandContext = {
      getNotesServices: async () => {
        throw new Error('notes');
      },
      getCardStore: async () => {
        throw new Error('cards');
      },
      getFolderRag: async () => rag,
      loadConfig: async () => {
        throw new Error('config');
      },
      ingestionJobs,
    };

    const started = await handleKnowledgeCommand(
      { type: 'doccards/index-folder', folderPath: folder },
      'r1',
      ctx,
    );
    expect(started).toMatchObject({
      success: true,
      data: { status: 'RUNNING' },
    });
    const jobId = (started as { data: { jobId: string } }).data.jobId;
    expect(jobId).toMatch(/^ing_/);
    expect(indexFolder).toHaveBeenCalledTimes(1);

    const mid = await handleKnowledgeCommand(
      { type: 'doccards/index-status', folderPath: folder },
      'r2',
      ctx,
    );
    expect(mid).toMatchObject({ success: true, data: { job: { id: jobId, status: 'RUNNING' } } });

    gate.resolve();
    await vi.waitFor(async () => {
      const terminal = await handleKnowledgeCommand(
        { type: 'doccards/index-status', folderPath: folder },
        'r3',
        ctx,
      );
      expect(terminal).toMatchObject({
        success: true,
        data: { job: { status: 'COMPLETED_DEGRADED', completedFiles: 1 } },
      });
    });
  });

  it('rejects a second index-folder while RUNNING', async () => {
    folder = await mkdtemp(join(tmpdir(), 'piwin-ing-'));
    await mkdir(folder, { recursive: true });
    const gate = deferred<void>();
    const rag = {
      indexFolder: vi.fn(async () => {
        await gate.promise;
        return { indexed: 0, chunks: 0, degraded: true, skipped: 0, warnings: [] };
      }),
    } as unknown as FolderRag;
    const ctx: KnowledgeCommandContext = {
      getNotesServices: async () => {
        throw new Error('notes');
      },
      getCardStore: async () => {
        throw new Error('cards');
      },
      getFolderRag: async () => rag,
      loadConfig: async () => {
        throw new Error('config');
      },
      ingestionJobs: createDoccardsIngestionRegistry(),
    };
    const first = await handleKnowledgeCommand(
      { type: 'doccards/index-folder', folderPath: folder },
      'a',
      ctx,
    );
    expect(first?.success).toBe(true);
    const second = await handleKnowledgeCommand(
      { type: 'doccards/index-folder', folderPath: folder },
      'b',
      ctx,
    );
    expect(second).toMatchObject({ success: false, error: 'INDEX_RUNNING' });
    gate.resolve();
  });
});
