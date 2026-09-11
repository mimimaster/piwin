import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextPack, HostPush } from '@piwin/contracts';
import { folderKnowledgeBaseId, NOTES_KNOWLEDGE_BASE_ID } from '@piwin/contracts';
import { canonicalizeFolderPath, createFolderRag, folderKey, type FolderRag } from '@piwin/doc-rag';
import { createNoteStore, openNoteIndex } from '@piwin/notes';
import { createSessionRecord, upsertSessionRecord } from '@piwin/session';
import { createDefaultPiwinConfig } from '../config-store.js';
import { getPiwinSessionIndexPath } from '../paths.js';
import { handleKnowledgeCommand, type KnowledgeCommandContext } from './knowledge-commands.js';

const cleanup: string[] = [];
const openIndexes: Array<{ close: () => void }> = [];

afterEach(async () => {
  for (const index of openIndexes.splice(0)) {
    index.close();
  }
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-kb-cmd-'));
  cleanup.push(root);
  const folder = await mkdtemp(join(tmpdir(), 'piwin-kb-src-'));
  cleanup.push(folder);
  await writeFile(join(folder, 'intro.md'), '# Intro\n\nSpaced repetition schedules reviews.\n');
  const store = createNoteStore({ piwinRoot: root });
  const index = await openNoteIndex(store);
  openIndexes.push(index);
  await store.write({ title: 'FSRS', content: 'Spaced repetition schedules reviews.' });
  const rag = createFolderRag({ piwinRoot: root });
  const pushes: HostPush[] = [];
  const context: KnowledgeCommandContext = {
    piwinRoot: root,
    getNotesServices: async () => ({ store, index, searchOptions: {} }),
    getCardStore: async () => {
      throw new Error('card store unused');
    },
    getFolderRag: async () => rag,
    loadConfig: async () => createDefaultPiwinConfig(),
    push: (message) => {
      pushes.push(message);
    },
  };
  return { root, folder, rag, context, pushes, index };
}

describe('knowledge base commands', () => {
  it('adds, lists, renames, and rejects a missing folder', async () => {
    const { folder, context, pushes, rag } = await setup();
    const added = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder, name: 'Docs' },
      'r1',
      context,
    );
    expect(added).toMatchObject({ success: true, command: 'knowledge/bases/add' });
    const base = (added as { data: { base: { id: string; name: string; folderPath: string } } }).data
      .base;
    expect(base.name).toBe('Docs');
    const canonical = await canonicalizeFolderPath(folder);
    expect(base.folderPath).toBe(canonical);
    expect(base.id).toBe(folderKnowledgeBaseId(folderKey(canonical ?? folder)));
    expect(pushes.some((push) => push.type === 'knowledge/bases-changed')).toBe(true);

    const again = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder, name: 'Other' },
      'r2',
      context,
    );
    expect(
      (again as { data: { base: { name: string } } }).data.base.name,
    ).toBe('Docs');

    const missing = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: join(folder, 'does-not-exist') },
      'r3',
      context,
    );
    expect(missing).toMatchObject({ success: false });

    const renamed = await handleKnowledgeCommand(
      { type: 'knowledge/bases/rename', baseId: base.id, name: 'Library' },
      'r4',
      context,
    );
    expect((renamed as { data: { base: { name: string } } }).data.base.name).toBe('Library');

    const listed = await handleKnowledgeCommand({ type: 'knowledge/bases/list' }, 'r5', context);
    const bases = (listed as { data: { bases: Array<{ id: string; kind: string }> } }).data.bases;
    expect(bases[0]?.kind).toBe('notes');
    expect(bases.some((item) => item.id === base.id)).toBe(true);

    rag.close();
  });

  it('refuses to remove the notes base and removes a folder base', async () => {
    const { folder, context, rag } = await setup();
    const added = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder },
      'r1',
      context,
    );
    const baseId = (added as { data: { base: { id: string } } }).data.base.id;

    const notesRemove = await handleKnowledgeCommand(
      { type: 'knowledge/bases/remove', baseId: NOTES_KNOWLEDGE_BASE_ID, deleteIndex: false },
      'r2',
      context,
    );
    expect(notesRemove).toMatchObject({ success: false });

    const removed = await handleKnowledgeCommand(
      { type: 'knowledge/bases/remove', baseId, deleteIndex: false },
      'r3',
      context,
    );
    expect(removed).toMatchObject({
      success: true,
      data: { removed: true, baseId },
    });
    rag.close();
  });

  it('searches notes and skips unknown bases', async () => {
    const { context, rag } = await setup();
    const result = await handleKnowledgeCommand(
      {
        type: 'knowledge/search',
        query: 'spaced repetition',
        baseIds: [NOTES_KNOWLEDGE_BASE_ID, 'folder:0123456789abcdef'],
      },
      'r1',
      context,
    );
    expect(result?.success).toBe(true);
    const data = (result as { data: { citations: Array<{ kind: string }>; skipped: Array<{ reason: string }> } })
      .data;
    expect(data.citations.some((citation) => citation.kind === 'notes')).toBe(true);
    expect(data.skipped.some((item) => item.reason === 'unknown')).toBe(true);
    rag.close();
  });

  it('mounts bases on a session index record and pushes session/index-updated', async () => {
    const { root, context, pushes, rag } = await setup();
    await mkdir(join(root, 'sessions-index'), { recursive: true });
    const indexPath = getPiwinSessionIndexPath(root);
    await upsertSessionRecord(
      indexPath,
      createSessionRecord({
        id: 'session-1',
        projectPath: root,
        name: 'chat',
      }),
    );
    const response = await handleKnowledgeCommand(
      {
        type: 'session/set-knowledge-bases',
        sessionId: 'session-1',
        baseIds: [NOTES_KNOWLEDGE_BASE_ID],
      },
      'r1',
      context,
    );
    expect(response).toMatchObject({
      success: true,
      data: { sessionId: 'session-1', baseIds: [NOTES_KNOWLEDGE_BASE_ID] },
    });
    expect(
      pushes.some(
        (push) =>
          push.type === 'session/index-updated' &&
          push.op === 'updated' &&
          push.session?.knowledgeBaseIds?.[0] === NOTES_KNOWLEDGE_BASE_ID,
      ),
    ).toBe(true);
    rag.close();
  });

  it('open-source for a folder citation is confined', async () => {
    const { folder, context, rag } = await setup();
    const added = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder },
      'r1',
      context,
    );
    const base = (added as { data: { base: { id: string } } }).data.base;
    const blocked = await handleKnowledgeCommand(
      {
        type: 'knowledge/open-source',
        citation: {
          ref: 1,
          baseId: base.id,
          baseName: 'Docs',
          kind: 'folder',
          title: 'secret',
          relativePath: '../etc/passwd',
          text: '',
        },
      },
      'r2',
      context,
    );
    expect(blocked).toMatchObject({ success: false });

    const opened = await handleKnowledgeCommand(
      {
        type: 'knowledge/open-source',
        citation: {
          ref: 1,
          baseId: base.id,
          baseName: 'Docs',
          kind: 'folder',
          title: 'intro.md',
          relativePath: 'intro.md',
          startLine: 1,
          text: 'Intro',
        },
      },
      'r3',
      context,
    );
    expect(opened).toMatchObject({ success: true });
    const data = (opened as { data: { kind: string; opened: boolean; absolutePath: string } }).data;
    expect(data.kind).toBe('folder');
    expect(data.opened).toBe(false);
    expect(data.absolutePath.endsWith('intro.md')).toBe(true);
    rag.close();
  });
});

describe('folder retrieve mapping via mocked rag', () => {
  it('returns folder citations from retrievePack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-kb-mock-'));
    cleanup.push(root);
    const folder = await mkdtemp(join(tmpdir(), 'piwin-kb-mock-src-'));
    cleanup.push(folder);
    await writeFile(join(folder, 'a.md'), 'hello');
    const pack: ContextPack = {
      query: 'hello',
      folderKey: '0123456789abcdef',
      retrievalMode: 'fts_only',
      degraded: true,
      sources: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          relativePath: 'a.md',
          startLine: 1,
          endLine: 1,
          text: 'hello world',
          retrievalScore: 0.9,
          retrievedBy: 'fts',
        },
      ],
    };
    const rag = {
      hasEmbeddingProvider: false,
      scanFolder: async () => ({ files: [], supportedExtensions: [] }),
      indexFolder: async () => ({
        indexed: 0,
        chunks: 0,
        degraded: true,
        skipped: 0,
        failed: 0,
        warnings: [],
      }),
      retrieve: async () => [],
      retrievePack: vi.fn(async () => pack),
      listDocuments: async () => [
        {
          documentId: 'd1',
          folderKey: '0123456789abcdef',
          relativePath: 'a.md',
          extension: '.md',
          fileSize: 5,
          fileHash: 'h',
          status: 'READY',
          chunkCount: 1,
          indexedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      isIndexed: async () => true,
      forgetFolder: async () => undefined,
      close: () => undefined,
    } as unknown as FolderRag;
    const store = createNoteStore({ piwinRoot: root });
    const index = await openNoteIndex(store);
    openIndexes.push(index);
    const context: KnowledgeCommandContext = {
      piwinRoot: root,
      getNotesServices: async () => ({ store, index, searchOptions: {} }),
      getCardStore: async () => {
        throw new Error('unused');
      },
      getFolderRag: async () => rag,
      loadConfig: async () => createDefaultPiwinConfig(),
    };
    const added = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder },
      'a1',
      context,
    );
    const baseId = (added as { data: { base: { id: string } } }).data.base.id;
    const searched = await handleKnowledgeCommand(
      { type: 'knowledge/search', query: 'hello', baseIds: [baseId] },
      's1',
      context,
    );
    const data = (
      searched as { data: { citations: Array<{ relativePath?: string }>; degradedBaseIds: string[] } }
    ).data;
    expect(data.citations[0]?.relativePath).toBe('a.md');
    expect(data.degradedBaseIds).toContain(baseId);
  });
});
