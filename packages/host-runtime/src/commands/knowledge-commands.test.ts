import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlashcardRecord } from '@piwin/contracts';
import type { CardStore } from '@piwin/flashcards';
import type { NoteIndex, NoteStore } from '@piwin/notes';
import type { KnowledgeCommandContext } from './knowledge-commands.js';
import { handleKnowledgeCommand, isKnowledgeCommand } from './knowledge-commands.js';

function createContext(store: NoteStore): KnowledgeCommandContext {
  return {
    getNotesServices: async () => ({
      store,
      index: {} as NoteIndex,
      searchOptions: {},
    }),
    getCardStore: async () => {
      throw new Error('card store should not be called');
    },
    getFolderRag: async () => {
      throw new Error('folder rag should not be called');
    },
    loadConfig: async () => {
      throw new Error('config should not be called');
    },
  };
}

function createCardContext(store: Pick<CardStore, 'read'>): KnowledgeCommandContext {
  return {
    getNotesServices: async () => {
      throw new Error('notes should not be called');
    },
    getCardStore: async () => store as CardStore,
    getFolderRag: async () => {
      throw new Error('folder rag should not be called');
    },
    loadConfig: async () => {
      throw new Error('config should not be called');
    },
  };
}

function folderCard(overrides: Partial<FlashcardRecord> & Pick<FlashcardRecord, 'sourceFolder' | 'sourceFile'>): FlashcardRecord {
  return {
    id: 'c1',
    model: 'basic',
    deck: 'docs',
    front: 'q',
    back: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('knowledge command handlers', () => {
  it('recognizes notes, flashcards, and doc-card commands', () => {
    expect(isKnowledgeCommand({ type: 'notes/list' })).toBe(true);
    expect(isKnowledgeCommand({ type: 'flashcards/decks' })).toBe(true);
    expect(isKnowledgeCommand({ type: 'doccards/scan-folder', folderPath: '/tmp/docs' })).toBe(
      true,
    );
    expect(isKnowledgeCommand({ type: 'knowledge/bases/list' })).toBe(true);
    expect(isKnowledgeCommand({ type: 'session/set-knowledge-bases', sessionId: 's1', baseIds: [] })).toBe(
      true,
    );
    expect(isKnowledgeCommand({ type: 'host/ping' })).toBe(false);
    expect(isKnowledgeCommand({ type: 'flashcards/study/catalog', limit: 20 })).toBe(false);
  });

  it('routes notes list through the injected store and preserves filters', async () => {
    const list = vi.fn(async () => [{ id: 'note-1' }]);
    const store = { list } as unknown as NoteStore;
    const response = await handleKnowledgeCommand(
      { type: 'notes/list', collection: 'work', tags: ['architecture'] },
      'request-1',
      createContext(store),
    );

    expect(list).toHaveBeenCalledWith({ collection: 'work', tags: ['architecture'] });
    expect(response).toMatchObject({
      id: 'request-1',
      type: 'response',
      command: 'notes/list',
      success: true,
      data: { records: [{ id: 'note-1' }] },
    });
  });

  it('fails closed when the application service seam is unavailable', async () => {
    const response = await handleKnowledgeCommand({ type: 'notes/list' }, undefined, undefined);
    expect(response).toMatchObject({
      type: 'response',
      command: 'notes/list',
      success: false,
    });
  });

  describe('doccards/open-source', () => {
    let folder: string;

    afterEach(async () => {
      if (folder) await rm(folder, { recursive: true, force: true });
    });

    it('resolves the path from store fields only', async () => {
      folder = await mkdtemp(join(tmpdir(), 'piwin-open-source-'));
      await writeFile(join(folder, 'a.md'), '# A');
      const read = vi.fn(async (cardId: string) => {
        expect(cardId).toBe('c1');
        return folderCard({ sourceFolder: folder, sourceFile: 'a.md', sourceLine: 1 });
      });
      const response = await handleKnowledgeCommand(
        { type: 'doccards/open-source', cardId: 'c1' },
        'r1',
        createCardContext({ read }),
      );
      expect(response).toMatchObject({
        id: 'r1',
        command: 'doccards/open-source',
        success: true,
        data: { opened: true },
      });
      const path = (response as { data: { path: string } }).data.path;
      expect(path.endsWith('/a.md')).toBe(true);
    });

    it('rejects a store sourceFile that escapes the folder', async () => {
      folder = await mkdtemp(join(tmpdir(), 'piwin-open-source-'));
      await mkdir(join(folder, 'docs'));
      const read = vi.fn(async () =>
        folderCard({ sourceFolder: folder, sourceFile: '../etc/passwd' }),
      );
      await expect(
        handleKnowledgeCommand(
          { type: 'doccards/open-source', cardId: 'c1' },
          'r1',
          createCardContext({ read }),
        ),
      ).rejects.toThrow(/not confined/);
    });
  });
});
