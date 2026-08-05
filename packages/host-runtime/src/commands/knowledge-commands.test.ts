import { describe, expect, it, vi } from 'vitest';
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

describe('knowledge command handlers', () => {
  it('recognizes notes, flashcards, and doc-card commands', () => {
    expect(isKnowledgeCommand({ type: 'notes/list' })).toBe(true);
    expect(isKnowledgeCommand({ type: 'flashcards/decks' })).toBe(true);
    expect(isKnowledgeCommand({ type: 'doccards/scan-folder', folderPath: '/tmp/docs' })).toBe(
      true,
    );
    expect(isKnowledgeCommand({ type: 'host/ping' })).toBe(false);
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
});
