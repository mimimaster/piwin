import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderRag } from '@piwin/doc-rag';
import { createNoteStore } from '@piwin/notes';
import {
  deleteNoteAndReindex,
  updateNoteAndReindex,
  writeNoteAndReindex,
} from './notes-write-service.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function ragMock(overrides?: {
  ingest?: FolderRag['ingestFile'];
  forget?: FolderRag['forgetFile'];
}): FolderRag {
  return {
    ingestFile:
      overrides?.ingest ??
      (async () => ({
        relativePath: 'default/x.md',
        documentId: 'd',
        status: 'READY',
        chunkCount: 1,
      })),
    forgetFile: overrides?.forget ?? (async () => undefined),
  } as unknown as FolderRag;
}

describe('notes-write-service', () => {
  it('writes then reindexes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-nws-'));
    cleanup.push(root);
    const store = createNoteStore({ piwinRoot: root });
    const ingestFile = vi.fn(async (folderPath: string, relativePath: string) => ({
      relativePath,
      documentId: 'd',
      status: 'READY' as const,
      chunkCount: 1,
    }));
    const rag = ragMock({ ingest: ingestFile });
    const result = await writeNoteAndReindex(
      { store, rag, piwinRoot: root },
      { title: 'Hello', content: 'Body' },
    );
    expect(result.indexed).toBe(true);
    expect(result.record.title).toBe('Hello');
    expect(ingestFile).toHaveBeenCalledWith(
      join(root, 'notes'),
      result.record.relativePath,
    );
  });

  it('returns indexed false when ingestFile throws after a successful write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-nws-'));
    cleanup.push(root);
    const store = createNoteStore({ piwinRoot: root });
    const rag = ragMock({
      ingest: async () => {
        throw new Error('embed down');
      },
    });
    const result = await writeNoteAndReindex(
      { store, rag, piwinRoot: root },
      { title: 'Hello', content: 'Body' },
    );
    expect(result.record.title).toBe('Hello');
    expect(result.indexed).toBe(false);
    expect(result.indexError).toBe('embed down');
    expect(await store.read(result.record.id)).toMatchObject({ title: 'Hello' });
  });

  it('returns indexed false when ingestFile reports FAILED', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-nws-'));
    cleanup.push(root);
    const store = createNoteStore({ piwinRoot: root });
    const rag = ragMock({
      ingest: async (_folderPath, relativePath) => ({
        relativePath,
        documentId: 'd',
        status: 'FAILED',
        chunkCount: 0,
        error: 'PARSER_FAILED',
      }),
    });
    const written = await writeNoteAndReindex(
      { store, rag, piwinRoot: root },
      { title: 'Hello', content: 'Body' },
    );
    expect(written.indexed).toBe(false);
    expect(written.indexError).toBe('PARSER_FAILED');
  });

  it('updates then reindexes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-nws-'));
    cleanup.push(root);
    const store = createNoteStore({ piwinRoot: root });
    const ingestFile = vi.fn(async (_folder: string, relativePath: string) => ({
      relativePath,
      documentId: 'd',
      status: 'READY' as const,
      chunkCount: 1,
    }));
    const rag = ragMock({ ingest: ingestFile });
    const created = await store.write({ title: 'Old', content: 'Body' });
    const updated = await updateNoteAndReindex(
      { store, rag, piwinRoot: root },
      { id: created.id, title: 'New' },
    );
    expect(updated.indexed).toBe(true);
    expect(updated.record.title).toBe('New');
    expect(ingestFile).toHaveBeenCalled();
  });

  it('deletes the file even when forgetFile fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-nws-'));
    cleanup.push(root);
    const store = createNoteStore({ piwinRoot: root });
    const created = await store.write({ title: 'Gone', content: 'Body' });
    const rag = ragMock({
      forget: async () => {
        throw new Error('lance locked');
      },
    });
    const result = await deleteNoteAndReindex({ store, rag, piwinRoot: root }, created.id);
    expect(result.deleted).toBe(true);
    expect(result.unindexed).toBe(false);
    expect(result.indexError).toBe('lance locked');
    await expect(store.read(created.id)).rejects.toThrow(/not found/);
  });
});
