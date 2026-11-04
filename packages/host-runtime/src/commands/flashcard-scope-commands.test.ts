import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { createCardStore } from '@piwin/flashcards';
import { handleKnowledgeCommand, type KnowledgeCommandContext } from './knowledge-commands.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('flashcards/draft-from-scope', () => {
  it('returns drafts without writing, then batch-create keeps wiki and topics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-fc-scope-'));
    cleanup.push(root);
    const cardStore = createCardStore({ piwinRoot: root });
    const context: KnowledgeCommandContext = {
      getNotesServices: async () => {
        throw new Error('notes');
      },
      getCardStore: async () => cardStore,
      getFolderRag: async () => {
        throw new Error('rag');
      },
      loadConfig: async () => ({ hostMode: 'sdk', providers: [] }) as unknown as PiwinConfig,
      completeJson: async (request) => {
        if (request.schemaName === 'knowledge_points') {
          return {
            knowledgePoints: [
              {
                tempId: 't1',
                concept: 'SRS',
                statement: 'A review schedule.',
                type: 'definition',
                importance: 0.9,
                sourceChunkIds: ['scope-1'],
              },
            ],
          };
        }
        return {
          cards: [
            {
              model: 'basic',
              front: 'What is SRS?',
              back: 'A review schedule.',
              cardType: 'definition',
              knowledgePointIds: [],
              sourceChunkIds: ['scope-1'],
            },
          ],
        };
      },
      piwinRoot: root,
    };

    const drafted = await handleKnowledgeCommand(
      {
        type: 'flashcards/draft-from-scope',
        scope: {
          kind: 'selection',
          text: 'Spaced repetition schedules reviews.',
          wikiSlug: 'fsrs',
          tags: ['memory', 'health'],
        },
      },
      'd1',
      context,
    );
    expect(drafted).toMatchObject({ success: true, command: 'flashcards/draft-from-scope' });
    const drafts = (drafted as { data: { drafts: Array<{ front?: string; wikiSlug?: string }> } }).data
      .drafts;
    expect(drafts[0]?.wikiSlug).toBe('fsrs');
    expect(await cardStore.list()).toHaveLength(0);

    const saved = await handleKnowledgeCommand(
      { type: 'flashcards/batch-create', input: { cards: drafts } },
      'd2',
      context,
    );
    expect(saved).toMatchObject({ success: true });
    const created = (saved as { data: { created: Array<{ id: string }> } }).data.created;
    expect(created).toHaveLength(1);

    const again = await handleKnowledgeCommand(
      { type: 'flashcards/batch-create', input: { cards: drafts } },
      'd3',
      context,
    );
    expect((again as { data: { skipped: unknown[] } }).data.skipped).toHaveLength(1);
    expect(await cardStore.list()).toHaveLength(1);

    const byTopic = await handleKnowledgeCommand(
      { type: 'flashcards/list', tag: 'health' },
      'd4',
      context,
    );
    const listed = (byTopic as { data: { cards: Array<{ id: string; wikiSlug?: string }> } }).data.cards;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created[0]?.id);
    expect(listed[0]?.wikiSlug).toBe('fsrs');
  });
});
