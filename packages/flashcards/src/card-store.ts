import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  FlashcardBatchCreateInput,
  FlashcardBatchSkip,
  FlashcardCreateInput,
  FlashcardItem,
  FlashcardReviewCard,
  ReviewRating,
  ReviewState,
} from '@piwin/contracts';
import { decodeCardMarkdown, encodeCardMarkdown } from './card-codec.js';
import {
  expandItemToReviewCards,
  isValidClozeText,
  itemPreviewText,
  parseReviewCardId,
  reviewStateFileName,
  stripClozeMarkers,
} from './cloze.js';
import { findNearDuplicate } from './dedup.js';
import {
  DEFAULT_DECK,
  assertInsideFlashcardsRoot,
  getCardsDir,
  getFlashcardsRoot,
  getReviewDir,
  sanitizeCardId,
} from './paths.js';
import { createInitialReviewState, rateCard } from './scheduler.js';

export type CardStoreOptions = {
  piwinRoot: string;
};

export class DuplicateCardError extends Error {
  override readonly name = 'DuplicateCardError';
  constructor(existingFront: string) {
    super(`near-duplicate card front already exists: ${existingFront.slice(0, 80)}`);
  }
}

export type CardStore = {
  create: (input: FlashcardCreateInput) => Promise<FlashcardItem>;
  batchCreate: (
    input: FlashcardBatchCreateInput,
    maxBatchSize?: number,
  ) => Promise<{ created: FlashcardItem[]; skipped: FlashcardBatchSkip[] }>;
  list: (filter?: {
    deck?: string;
    sourceNoteId?: string;
    sourceFolder?: string;
    sequenceId?: string;
  }) => Promise<FlashcardItem[]>;
  listReviewCards: (filter?: {
    deck?: string;
    sourceNoteId?: string;
    sourceFolder?: string;
    sequenceId?: string;
  }) => Promise<FlashcardReviewCard[]>;
  read: (itemId: string) => Promise<FlashcardItem>;
  delete: (cardId: string) => Promise<{ deleted: true; id: string }>;
  deleteBySourceFolder: (folderPath: string) => Promise<{ deleted: number }>;
  rebindSourceFolder: (oldPath: string, newPath: string) => Promise<{ updated: number }>;
  listDecks: () => Promise<string[]>;
  /** Review-state access (user data as JSON files, never sqlite-only). */
  getReviewState: (cardId: string) => Promise<ReviewState>;
  loadReviewStates: () => Promise<Map<string, ReviewState>>;
  rate: (cardId: string, rating: ReviewRating, now?: Date) => Promise<ReviewState>;
  getFlashcardsRoot: () => string;
};

export function createCardStore(options: CardStoreOptions): CardStore {
  const flashcardsRoot = getFlashcardsRoot(options.piwinRoot);
  const cardsDir = getCardsDir(flashcardsRoot);
  const reviewDir = getReviewDir(flashcardsRoot);

  async function ensureDirs(): Promise<void> {
    await mkdir(cardsDir, { recursive: true });
    await mkdir(reviewDir, { recursive: true });
  }

  async function scanItems(): Promise<FlashcardItem[]> {
    await ensureDirs();
    let entries: string[];
    try {
      entries = await readdir(cardsDir);
    } catch {
      return [];
    }
    const items: FlashcardItem[] = [];
    for (const entry of entries.sort()) {
      if (!entry.toLowerCase().endsWith('.md')) continue;
      try {
        const raw = await readFile(join(cardsDir, entry), 'utf8');
        const item = decodeCardMarkdown(raw);
        if (item) items.push(item);
      } catch {
        // unreadable file — skip, do not fail the whole listing
      }
    }
    return items;
  }

  function itemPath(itemId: string): string {
    sanitizeCardId(itemId);
    return assertInsideFlashcardsRoot(flashcardsRoot, join(cardsDir, `${itemId}.md`));
  }

  function reviewPath(cardId: string): string {
    const { itemId } = parseReviewCardId(cardId);
    sanitizeCardId(itemId);
    return assertInsideFlashcardsRoot(flashcardsRoot, join(reviewDir, reviewStateFileName(cardId)));
  }

  async function deleteReviewFiles(itemId: string): Promise<void> {
    sanitizeCardId(itemId);
    await rm(assertInsideFlashcardsRoot(flashcardsRoot, join(reviewDir, `${itemId}.json`)), {
      force: true,
    });
    let entries: string[];
    try {
      entries = await readdir(reviewDir);
    } catch {
      return;
    }
    const prefix = `${itemId}--c`;
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || !entry.endsWith('.json')) continue;
      await rm(assertInsideFlashcardsRoot(flashcardsRoot, join(reviewDir, entry)), { force: true });
    }
  }

  /**
   * Review state is user data (ADR 0018): a corrupted file must never be
   * silently reset. Missing file → null (caller may initialize); corrupt
   * file → preserved as .bak, logged, then treated as missing.
   */
  async function readReviewState(cardId: string): Promise<ReviewState | null> {
    const path = reviewPath(cardId);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return null; // genuinely missing — safe to initialize
    }
    try {
      const parsed = JSON.parse(raw) as ReviewState;
      if (typeof parsed.due !== 'string') {
        throw new Error('missing due field');
      }
      return parsed;
    } catch (error) {
      const backupPath = `${path}.bak`;
      await rename(path, backupPath).catch(() => undefined);
      console.warn(
        `[piwin/flashcards] corrupt review state for ${cardId} preserved at ${backupPath}: ${
          error instanceof Error ? error.message : 'parse error'
        }`,
      );
      return null;
    }
  }

  /** Atomic write (tmp + rename): crash mid-write never truncates user data. */
  async function writeReviewState(state: ReviewState): Promise<void> {
    await ensureDirs();
    const path = reviewPath(state.cardId);
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tmpPath, path);
  }

  async function ensureReviewStates(item: FlashcardItem): Promise<void> {
    for (const card of expandItemToReviewCards(item)) {
      const existing = await readReviewState(card.cardId);
      if (!existing) {
        await writeReviewState(createInitialReviewState(card.cardId));
      }
    }
  }

  async function requireReviewCard(cardId: string): Promise<FlashcardReviewCard> {
    const { itemId } = parseReviewCardId(cardId);
    const item = await readItem(itemId);
    const card = expandItemToReviewCards(item).find((entry) => entry.cardId === cardId);
    if (!card) {
      throw new Error(`review card not found: ${cardId}`);
    }
    return card;
  }

  async function readItem(itemId: string): Promise<FlashcardItem> {
    const raw = await readFile(itemPath(itemId), 'utf8').catch(() => null);
    const item = raw ? decodeCardMarkdown(raw) : null;
    if (!item) {
      throw new Error(`card not found: ${itemId}`);
    }
    return item;
  }

  function applyInputFields(item: FlashcardItem, input: FlashcardCreateInput): void {
    if (input.sourceNoteId) item.sourceNoteId = input.sourceNoteId;
    if (input.sourceExcerpt) item.sourceExcerpt = input.sourceExcerpt;
    if (input.sourceFolder) item.sourceFolder = input.sourceFolder;
    if (input.sourceFile) item.sourceFile = input.sourceFile;
    if (typeof input.sourceLine === 'number') item.sourceLine = input.sourceLine;
    if (input.tags && input.tags.length > 0) item.tags = input.tags;
    if (input.sequenceId) item.sequenceId = input.sequenceId;
    if (typeof input.position === 'number') item.position = input.position;
    if (input.cardType) item.cardType = input.cardType;
    if (input.relationFromPrevious) item.relationFromPrevious = input.relationFromPrevious;
    if (input.knowledgePointIds && input.knowledgePointIds.length > 0) {
      item.knowledgePointIds = input.knowledgePointIds;
    }
    if (input.sourceChunkIds && input.sourceChunkIds.length > 0) {
      item.sourceChunkIds = input.sourceChunkIds;
    }
    if (input.generationId) item.generationId = input.generationId;
    if (input.sourceDocumentIds && input.sourceDocumentIds.length > 0) {
      item.sourceDocumentIds = input.sourceDocumentIds;
    }
  }

  function buildItem(input: FlashcardCreateInput): FlashcardItem {
    const deck = input.deck ?? DEFAULT_DECK;
    const id = `card-${randomUUID().slice(0, 8)}-${Date.now().toString(36)}`;
    const createdAt = new Date().toISOString();
    if (input.model === 'cloze') {
      const text = (input.text ?? '').trim();
      if (!isValidClozeText(text)) {
        throw new Error('cloze text must contain 1-8 valid {{cN::answer}} markers');
      }
      const item: FlashcardItem = { id, model: 'cloze', deck, text, createdAt };
      applyInputFields(item, input);
      return item;
    }
    const front = (input.front ?? '').trim();
    const back = (input.back ?? '').trim();
    if (!front || !back) {
      throw new Error('card front and back must be non-empty');
    }
    const item: FlashcardItem = { id, model: 'basic', deck, front, back, createdAt };
    applyInputFields(item, input);
    return item;
  }

  function inputPreview(input: FlashcardCreateInput): string {
    if (input.model === 'cloze') {
      return stripClozeMarkers(input.text ?? '').trim();
    }
    return (input.front ?? '').trim();
  }

  return {
    getFlashcardsRoot: () => flashcardsRoot,

    async create(input) {
      await ensureDirs();
      const item = buildItem(input);
      const preview = itemPreviewText(item);

      const existing = await scanItems();
      const comparable = existing.filter((entry) =>
        input.sourceFolder
          ? entry.sourceFolder === input.sourceFolder
          : entry.deck === item.deck && !entry.sourceFolder,
      );
      const duplicate = findNearDuplicate(
        preview,
        comparable.map((entry) => itemPreviewText(entry)),
      );
      if (duplicate) {
        throw new DuplicateCardError(duplicate);
      }

      await writeFile(itemPath(item.id), encodeCardMarkdown(item), 'utf8');
      await ensureReviewStates(item);
      return item;
    },

    async batchCreate(input, maxBatchSize = 40) {
      if (input.cards.length === 0) {
        throw new Error('batchCreate: cards array must be non-empty');
      }
      if (input.cards.length > maxBatchSize) {
        throw new Error(
          `batchCreate: cards.length ${input.cards.length} exceeds maxBatchSize ${maxBatchSize}`,
        );
      }
      const created: FlashcardItem[] = [];
      const skipped: FlashcardBatchSkip[] = [];
      for (const cardInput of input.cards) {
        try {
          created.push(await this.create(cardInput));
        } catch (error) {
          if (error instanceof DuplicateCardError) {
            skipped.push({ front: inputPreview(cardInput), reason: 'duplicate' });
          } else {
            skipped.push({
              front: inputPreview(cardInput),
              reason: 'validation',
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      return { created, skipped };
    },

    async list(filter) {
      const items = await scanItems();
      return items
        .filter((item) => {
          if (filter?.deck && item.deck !== filter.deck) return false;
          if (filter?.sourceNoteId && item.sourceNoteId !== filter.sourceNoteId) return false;
          if (filter?.sourceFolder && item.sourceFolder !== filter.sourceFolder) return false;
          if (filter?.sequenceId && item.sequenceId !== filter.sequenceId) return false;
          return true;
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    async listReviewCards(filter) {
      const items = await this.list(filter);
      const cards: FlashcardReviewCard[] = [];
      for (const item of items) {
        cards.push(...expandItemToReviewCards(item));
      }
      return cards.sort((left, right) => {
        const position = (left.position ?? 0) - (right.position ?? 0);
        if (position !== 0) return position;
        return left.ordinal - right.ordinal;
      });
    },

    async read(itemId) {
      return readItem(itemId);
    },

    async delete(cardId) {
      const { itemId } = parseReviewCardId(cardId);
      await readItem(itemId);
      await rm(itemPath(itemId));
      await deleteReviewFiles(itemId);
      return { deleted: true, id: itemId };
    },

    async deleteBySourceFolder(folderPath) {
      const items = await scanItems();
      const matching = items.filter((item) => item.sourceFolder === folderPath);
      for (const item of matching) {
        await rm(itemPath(item.id));
        await deleteReviewFiles(item.id);
      }
      return { deleted: matching.length };
    },

    async rebindSourceFolder(oldPath, newPath) {
      const items = await scanItems();
      const matching = items.filter((item) => item.sourceFolder === oldPath);
      for (const item of matching) {
        const updated: FlashcardItem = { ...item, sourceFolder: newPath };
        await writeFile(itemPath(item.id), encodeCardMarkdown(updated), 'utf8');
      }
      return { updated: matching.length };
    },

    async listDecks() {
      const items = await scanItems();
      return [...new Set(items.map((item) => item.deck))].sort();
    },

    async getReviewState(cardId) {
      await requireReviewCard(cardId);
      const state = await readReviewState(cardId);
      if (state) return state;
      const initial = createInitialReviewState(cardId);
      await writeReviewState(initial);
      return initial;
    },

    async loadReviewStates() {
      const items = await scanItems();
      const states = new Map<string, ReviewState>();
      for (const item of items) {
        for (const card of expandItemToReviewCards(item)) {
          const state = await readReviewState(card.cardId);
          if (state) {
            states.set(card.cardId, state);
          } else {
            const initial = createInitialReviewState(card.cardId);
            await writeReviewState(initial);
            states.set(card.cardId, initial);
          }
        }
      }
      return states;
    },

    async rate(cardId, rating, now) {
      await requireReviewCard(cardId);
      const current = await this.getReviewState(cardId);
      const next = rateCard(current, rating, now);
      await writeReviewState(next);
      return next;
    },
  };
}
