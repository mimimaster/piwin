/**
 * Host customTools for flashcards (ADR 0018 §7).
 * Generation is agent-driven: the model calls flashcard_create during a
 * "generate cards from …" conversation. Existing deck fronts are exposed via
 * flashcard_list so the model can avoid duplicates; the store's trigram
 * dedup is the safety net.
 */
import type { FlashcardCreateInput, PermissionDecision } from '@piwin/contracts';
import type { CardStore } from '@piwin/flashcards';
import { buildFlashcardArtifactHtml } from '@piwin/flashcards';
import type { HostToolDefinition } from '@piwin/tools-web';
import type { ToolPermissionGate } from './session-tools.js';

export type BuildFlashcardToolsOptions = {
  store: CardStore;
  /** When false, returns no tools. */
  enabled: boolean;
  requestPermission?: ToolPermissionGate;
};

export function buildFlashcardTools(options: BuildFlashcardToolsOptions): HostToolDefinition[] {
  if (!options.enabled) {
    return [];
  }
  const { store } = options;
  const tools: HostToolDefinition[] = [
    {
      name: 'flashcard_create',
      description:
        'Create a flashcard in the user card library. Call flashcard_list first for the target deck and avoid duplicating existing fronts. When generating from a note, pass sourceNoteId and a short sourceExcerpt. The result includes artifactHtml — to show an interactive flip card in chat, output it inside a ```html fence verbatim.',
      parameters: {
        type: 'object',
        properties: {
          front: { type: 'string', description: 'Question side (markdown)' },
          back: { type: 'string', description: 'Answer side (markdown)' },
          deck: { type: 'string', description: 'Deck name, default "default"' },
          sourceNoteId: { type: 'string' },
          sourceExcerpt: { type: 'string', description: 'Short snapshot of the source passage' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['front', 'back'],
      },
      async execute(args) {
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
        if (Array.isArray(args.tags)) {
          const tags = args.tags.filter((item): item is string => typeof item === 'string');
          if (tags.length > 0) input.tags = tags;
        }
        const card = await store.create(input);
        return JSON.stringify(
          { card, artifactHtml: buildFlashcardArtifactHtml(card) },
          null,
          2,
        );
      },
    },
    {
      name: 'flashcard_list',
      description:
        'List flashcards (id, deck, front, sourceNoteId). Use before flashcard_create to avoid duplicates.',
      parameters: {
        type: 'object',
        properties: {
          deck: { type: 'string' },
          sourceNoteId: { type: 'string' },
        },
      },
      async execute(args) {
        const filter: { deck?: string; sourceNoteId?: string } = {};
        if (typeof args.deck === 'string' && args.deck) filter.deck = args.deck;
        if (typeof args.sourceNoteId === 'string' && args.sourceNoteId) {
          filter.sourceNoteId = args.sourceNoteId;
        }
        const cards = await store.list(filter);
        return JSON.stringify(
          cards.map((card) => ({
            id: card.id,
            deck: card.deck,
            front: card.front,
            sourceNoteId: card.sourceNoteId,
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
