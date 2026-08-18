/**
 * Host customTools for flashcards (ADR 0018 §7).
 * Generation is agent-driven: the model calls flashcard_create during a
 * "generate cards from …" conversation. Existing deck fronts are exposed via
 * flashcard_list so the model can avoid duplicates; the store's trigram dedup
 * is the safety net.
 */
import type { FlashcardCreateInput, HostToolRegistration, ToolResult } from '@piwin/contracts';
import type { CardStore } from '@piwin/flashcards';
import {
  buildFlashcardArtifactHtml,
  buildFlashcardBatchArtifactHtml,
  expandItemToReviewCards,
  itemPreviewText,
} from '@piwin/flashcards';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';

export type BuildFlashcardToolsOptions = {
  store: CardStore;
  /** When false, returns no tools. */
  enabled: boolean;
  /** Max cards per flashcard_batch_create. Default 40. */
  maxBatchSize?: number;
};

function invalidFlashcardInput(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

export function buildFlashcardTools(options: BuildFlashcardToolsOptions): HostToolRegistration[] {
  if (!options.enabled) {
    return [];
  }
  const { store } = options;
  const maxBatchSize = options.maxBatchSize ?? 40;
  const tools: HostToolRegistration[] = [
    {
      descriptor: {
        name: 'flashcard_create',
        description:
          'Create a flashcard item in the user card library. model is "basic" (front/back Q&A, default) or "cloze" (text with {{cN::answer}} markers; each N becomes its own review card). Call flashcard_list first to avoid duplicates. When generating from a note, pass sourceNoteId and a short sourceExcerpt. When generating from a folder (RAG-sourced), pass sourceFolder, sourceFile, sourceLine, and sourceExcerpt. The result includes artifactHtml — to show interactive flip cards in chat, output it inside a ```html fence verbatim.',
        parameters: {
          type: 'object',
          properties: {
            model: {
              type: 'string',
              enum: ['basic', 'cloze'],
              description: 'basic = front/back. cloze = text with {{cN::answer}} markers.',
            },
            front: { type: 'string', description: 'Question side (markdown). Required for basic.' },
            back: { type: 'string', description: 'Answer side (markdown). Required for basic.' },
            text: {
              type: 'string',
              description: 'Cloze passage with {{c1::answer}} markers. Required for cloze.',
            },
            deck: { type: 'string', description: 'Deck name, default "default"' },
            sourceNoteId: { type: 'string' },
            sourceExcerpt: { type: 'string', description: 'Short snapshot of the source passage' },
            sourceFolder: {
              type: 'string',
              description: 'Absolute path of the source folder (folder mode)',
            },
            sourceFile: {
              type: 'string',
              description: 'Relative path of the source file under sourceFolder',
            },
            sourceLine: { type: 'number', description: '1-based line number of the excerpt start' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      family: 'flashcards-write',
      permissionSpec: {
        action: 'flashcards:create',
        risk: 'unknown',
        rememberable: false,
        subjectBuilder: () => ({ kind: 'tool', action: 'flashcards:create' }),
      },
      prepareArgs: passThroughPrepareArgs,
      async execute(args) {
        const input = parseCardInput(args);
        const invalid = validateCreateInput(input);
        if (invalid) return invalidFlashcardInput(invalid);
        try {
          const card = await store.create(input);
          const reviewCards = expandItemToReviewCards(card);
          const artifactHtml =
            reviewCards.length === 1 && reviewCards[0]
              ? buildFlashcardArtifactHtml(reviewCards[0])
              : buildFlashcardBatchArtifactHtml(reviewCards);
          return {
            ok: true,
            output: JSON.stringify({ card, artifactHtml }, null, 2),
            details: { cardId: card.id },
          };
        } catch (error) {
          return invalidFlashcardInput(error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      descriptor: {
        name: 'flashcard_batch_create',
        description:
          'Create multiple flashcard items in one call (preferred for batch generation). Each item may be model "basic" (front/back) or "cloze" (text with {{cN::answer}}). Call flashcard_list first to avoid duplicates. Each item may carry sourceFolder/sourceFile/sourceLine/sourceExcerpt for folder-sourced cards, or sourceNoteId/sourceExcerpt for note-sourced cards, or no source fields for open-knowledge cards. Returns { created, skipped, artifactHtml } — output artifactHtml inside a ```html fence verbatim to show interactive flip cards. Duplicates are skipped (not fatal).',
        parameters: {
          type: 'object',
          properties: {
            cards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  model: { type: 'string', enum: ['basic', 'cloze'] },
                  front: { type: 'string' },
                  back: { type: 'string' },
                  text: { type: 'string' },
                  deck: { type: 'string' },
                  sourceNoteId: { type: 'string' },
                  sourceExcerpt: { type: 'string' },
                  sourceFolder: { type: 'string' },
                  sourceFile: { type: 'string' },
                  sourceLine: { type: 'number' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
          required: ['cards'],
        },
      },
      family: 'flashcards-write',
      permissionSpec: {
        action: 'flashcards:batch-create',
        risk: 'unknown',
        rememberable: false,
        subjectBuilder: () => ({ kind: 'tool', action: 'flashcards:batch-create' }),
      },
      prepareArgs: passThroughPrepareArgs,
      async execute(args) {
        if (!Array.isArray(args.cards) || args.cards.length === 0) {
          return invalidFlashcardInput('cards must be a non-empty array');
        }
        const cards = args.cards;
        const inputs = cards.map((card) => parseCardInput(card as Record<string, unknown>));
        const result = await store.batchCreate({ cards: inputs }, maxBatchSize);
        const reviewCards = result.created.flatMap((item) => expandItemToReviewCards(item));
        const artifactHtml = buildFlashcardBatchArtifactHtml(reviewCards);
        return {
          ok: true,
          output: JSON.stringify({ ...result, artifactHtml }, null, 2),
          details: { created: result.created.length, skipped: result.skipped.length },
        };
      },
    },
    {
      descriptor: {
        name: 'flashcard_list',
        description:
          'List flashcard items (id, model, deck, preview, sourceNoteId, sourceFolder). Preview is the basic front or cloze text with markers stripped. Cloze items are not exploded into per-blank rows. Use before flashcard_create or flashcard_batch_create to avoid duplicates.',
        parameters: {
          type: 'object',
          properties: {
            deck: { type: 'string' },
            sourceNoteId: { type: 'string' },
            sourceFolder: { type: 'string' },
          },
        },
      },
      family: 'flashcards-read',
      permissionSpec: {
        action: 'flashcards:list',
        risk: 'unknown',
        rememberable: false,
        readOnly: true,
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
        return {
          ok: true,
          output: JSON.stringify(
            cards.map((card) => ({
              id: card.id,
              model: card.model,
              deck: card.deck,
              front: itemPreviewText(card),
              sourceNoteId: card.sourceNoteId,
              sourceFolder: card.sourceFolder,
            })),
            null,
            2,
          ),
          details: { count: cards.length },
        };
      },
    },
    {
      descriptor: {
        name: 'flashcard_delete',
        description: 'Delete a flashcard by id (requires user permission).',
        parameters: {
          type: 'object',
          properties: {
            cardId: { type: 'string' },
          },
          required: ['cardId'],
        },
      },
      family: 'flashcards-write',
      permissionSpec: {
        action: 'flashcards:delete',
        risk: 'unknown',
        rememberable: false,
        subjectBuilder: () => ({ kind: 'tool', action: 'flashcards:delete' }),
      },
      prepareArgs: passThroughPrepareArgs,
      async execute(args, signal) {
        const cardId = String(args.cardId ?? '').trim();
        if (!cardId) {
          return invalidFlashcardInput('cardId is required');
        }
        if (signal.aborted) {
          return {
            ok: false,
            code: 'aborted',
            message: 'flashcard deletion aborted',
            cancelled: true,
          };
        }
        const result = await store.delete(cardId);
        return {
          ok: true,
          output: JSON.stringify(result, null, 2),
          details: { cardId },
        };
      },
    },
  ];
  return tools;
}

function validateCreateInput(input: FlashcardCreateInput): string | null {
  if (input.model === 'cloze') {
    return (input.text ?? '').trim() ? null : 'cloze items require text with {{cN::answer}} markers';
  }
  if (!(input.front ?? '').trim() || !(input.back ?? '').trim()) {
    return 'basic items require front and back';
  }
  return null;
}

function parseCardInput(args: Record<string, unknown>): FlashcardCreateInput {
  const input: FlashcardCreateInput = {};
  if (args.model === 'cloze' || args.model === 'basic') input.model = args.model;
  if (typeof args.front === 'string') input.front = args.front;
  if (typeof args.back === 'string') input.back = args.back;
  if (typeof args.text === 'string') input.text = args.text;
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
