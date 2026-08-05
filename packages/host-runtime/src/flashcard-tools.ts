/**
 * Host customTools for flashcards (ADR 0018 §7).
 * Generation is agent-driven: the model calls flashcard_create during a
 * "generate cards from …" conversation. Existing deck fronts are exposed via
 * flashcard_list so the model can avoid duplicates; the store's trigram
 * dedup is the safety net.
 */
import type { FlashcardCreateInput, PermissionDecision } from '@piwin/contracts';
import type { CardStore } from '@piwin/flashcards';
import { buildFlashcardArtifactHtml, buildFlashcardBatchArtifactHtml } from '@piwin/flashcards';
import type { HostToolDefinition } from '@piwin/tools-web';
import type { ToolPermissionGate } from './session-tools.js';

export type BuildFlashcardToolsOptions = {
  store: CardStore;
  /** When false, returns no tools. */
  enabled: boolean;
  /** Max cards per flashcard_batch_create. Default 40. */
  maxBatchSize?: number;
  requestPermission?: ToolPermissionGate;
};

export function buildFlashcardTools(options: BuildFlashcardToolsOptions): HostToolDefinition[] {
  if (!options.enabled) {
    return [];
  }
  const { store } = options;
  const maxBatchSize = options.maxBatchSize ?? 40;
  const tools: HostToolDefinition[] = [
    {
      name: 'flashcard_create',
      description:
        'Create a flashcard in the user card library. Call flashcard_list first for the target deck and avoid duplicating existing fronts. When generating from a note, pass sourceNoteId and a short sourceExcerpt. When generating from a folder (RAG-sourced), pass sourceFolder, sourceFile, sourceLine, and sourceExcerpt. The result includes artifactHtml — to show an interactive flip card in chat, output it inside a ```html fence verbatim.',
      parameters: {
        type: 'object',
        properties: {
          front: { type: 'string', description: 'Question side (markdown)' },
          back: { type: 'string', description: 'Answer side (markdown)' },
          deck: { type: 'string', description: 'Deck name, default "default"' },
          sourceNoteId: { type: 'string' },
          sourceExcerpt: { type: 'string', description: 'Short snapshot of the source passage' },
          sourceFolder: { type: 'string', description: 'Absolute path of the source folder (folder mode)' },
          sourceFile: { type: 'string', description: 'Relative path of the source file under sourceFolder' },
          sourceLine: { type: 'number', description: '1-based line number of the excerpt start' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['front', 'back'],
      },
      async execute(args) {
        const input = parseCardInput(args);
        const card = await store.create(input);
        return JSON.stringify(
          { card, artifactHtml: buildFlashcardArtifactHtml(card) },
          null,
          2,
        );
      },
    },
    {
      name: 'flashcard_batch_create',
      description:
        'Create multiple flashcards in one call (preferred for batch generation). Call flashcard_list first to avoid duplicates. Each card may carry sourceFolder/sourceFile/sourceLine/sourceExcerpt for folder-sourced cards, or sourceNoteId/sourceExcerpt for note-sourced cards, or no source fields for open-knowledge cards. Returns { created, skipped, artifactHtml } — output artifactHtml inside a ```html fence verbatim to show interactive flip cards. Duplicates are skipped (not fatal).',
      parameters: {
        type: 'object',
        properties: {
          cards: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                front: { type: 'string' },
                back: { type: 'string' },
                deck: { type: 'string' },
                sourceNoteId: { type: 'string' },
                sourceExcerpt: { type: 'string' },
                sourceFolder: { type: 'string' },
                sourceFile: { type: 'string' },
                sourceLine: { type: 'number' },
                tags: { type: 'array', items: { type: 'string' } },
              },
              required: ['front', 'back'],
            },
          },
        },
        required: ['cards'],
      },
      async execute(args) {
        const cards = Array.isArray(args.cards) ? args.cards : [];
        const inputs = cards.map((card) => parseCardInput(card));
        const result = await store.batchCreate({ cards: inputs }, maxBatchSize);
        const artifactHtml = buildFlashcardBatchArtifactHtml(result.created);
        return JSON.stringify(
          { ...result, artifactHtml },
          null,
          2,
        );
      },
    },
    {
      name: 'flashcard_list',
      description:
        'List flashcards (id, deck, front, sourceNoteId, sourceFolder). Use before flashcard_create or flashcard_batch_create to avoid duplicates.',
      parameters: {
        type: 'object',
        properties: {
          deck: { type: 'string' },
          sourceNoteId: { type: 'string' },
          sourceFolder: { type: 'string' },
        },
      },
      async execute(args) {
        const filter: { deck?: string; sourceNoteId?: string; sourceFolder?: string } = {};
        if (typeof args.deck === 'string' && args.deck) filter.deck = args.deck;
        if (typeof args.sourceNoteId === 'string' && args.sourceNoteId) {
          filter.sourceNoteId = args.sourceNoteId;
        }
        if (typeof args.sourceFolder === 'string' && args.sourceFolder) {
          filter.sourceFolder = args.sourceFolder;
        }
        const cards = await store.list(filter);
        return JSON.stringify(
          cards.map((card) => ({
            id: card.id,
            deck: card.deck,
            front: card.front,
            sourceNoteId: card.sourceNoteId,
            sourceFolder: card.sourceFolder,
          })),
          null,
          2,
        );
      },
    },
    {
      name: 'flashcard_delete',
      description: 'Delete a flashcard by id (requires user permission).',
      parameters: {
        type: 'object',
        properties: {
          cardId: { type: 'string' },
        },
        required: ['cardId'],
      },
      async execute(args, signal) {
        const cardId = String(args.cardId ?? '');
        if (!cardId) {
          throw new Error('cardId required');
        }
        let decision: PermissionDecision = 'ask';
        if (options.requestPermission) {
          decision = await options.requestPermission({
            action: 'flashcards:delete',
            detail: cardId,
            defaultDecision: 'ask',
          });
        } else {
          decision = 'deny'; // non-interactive: never auto-approve destructive ops
        }
        if (decision !== 'allow') {
          throw new Error(`Permission ${decision} for flashcard_delete (${cardId})`);
        }
        void signal;
        const result = await store.delete(cardId);
        return JSON.stringify(result, null, 2);
      },
    },
  ];
  return tools;
}

function parseCardInput(args: Record<string, unknown>): FlashcardCreateInput {
  const input: FlashcardCreateInput = {
    front: String(args.front ?? ''),
    back: String(args.back ?? ''),
  };
  if (typeof args.deck === 'string' && args.deck) input.deck = args.deck;
  if (typeof args.sourceNoteId === 'string' && args.sourceNoteId) {
    input.sourceNoteId = args.sourceNoteId;
  }
  if (typeof args.sourceExcerpt === 'string' && args.sourceExcerpt) {
    input.sourceExcerpt = args.sourceExcerpt.slice(0, 500);
  }
  if (typeof args.sourceFolder === 'string' && args.sourceFolder) {
    input.sourceFolder = args.sourceFolder;
  }
  if (typeof args.sourceFile === 'string' && args.sourceFile) {
    input.sourceFile = args.sourceFile;
  }
  if (typeof args.sourceLine === 'number' && Number.isFinite(args.sourceLine)) {
    input.sourceLine = args.sourceLine;
  }
  if (Array.isArray(args.tags)) {
    const tags = args.tags.filter((item): item is string => typeof item === 'string');
    if (tags.length > 0) input.tags = tags;
  }
  return input;
}
