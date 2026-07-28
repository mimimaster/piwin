import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  FlashcardBatchCreateInput,
  FlashcardBatchSkip,
  FlashcardCreateInput,
  FlashcardRecord,
  ReviewRating,
  ReviewState,
} from '@piwin/contracts';
import { decodeCardMarkdown, encodeCardMarkdown } from './card-codec.js';
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
  create: (input: FlashcardCreateInput) => Promise<FlashcardRecord>;
  batchCreate: (input: FlashcardBatchCreateInput, maxBatchSize?: number) => Promise<{ created: FlashcardRecord[]; skipped: FlashcardBatchSkip[] }>;
  list: (filter?: { deck?: string; sourceNoteId?: string; sourceFolder?: string }) => Promise<FlashcardRecord[]>;
  read: (cardId: string) => Promise<FlashcardRecord>;
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

  async function scanCards(): Promise<FlashcardRecord[]> {
    await ensureDirs();
    let entries: string[];
    try {
      entries = await readdir(cardsDir);
    } catch {
      return [];
    }
    const cards: FlashcardRecord[] = [];
    for (const entry of entries.sort()) {
      if (!entry.toLowerCase().endsWith('.md')) continue;
      try {
        const raw = await readFile(join(cardsDir, entry), 'utf8');
        const card = decodeCardMarkdown(raw);
        if (card) cards.push(card);
      } catch {
        // unreadable file — skip, do not fail the whole listing
      }
    }
    return cards;
  }

  function cardPath(cardId: string): string {
    sanitizeCardId(cardId);
    return assertInsideFlashcardsRoot(flashcardsRoot, join(cardsDir, `${cardId}.md`));
  }

  function reviewPath(cardId: string): string {
    sanitizeCardId(cardId);
    return assertInsideFlashcardsRoot(flashcardsRoot, join(reviewDir, `${cardId}.json`));
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

  return {
    getFlashcardsRoot: () => flashcardsRoot,

    async create(input) {
      await ensureDirs();
      const deck = input.deck ?? DEFAULT_DECK;
      const front = input.front.trim();
      const back = input.back.trim();
      if (!front || !back) {
        throw new Error('card front and back must be non-empty');
      }

      // Dedup within the same deck (safety net behind LLM-side avoidance).
      const existing = await scanCards();
      const deckFronts = existing
        .filter((card) => card.deck === deck)
        .map((card) => card.front);
      const duplicate = findNearDuplicate(front, deckFronts);
      if (duplicate) {
        throw new DuplicateCardError(duplicate);
      }

      const id = `card-${randomUUID().slice(0, 8)}-${Date.now().toString(36)}`;
      const card: FlashcardRecord = {
        id,
        deck,
        front,
        back,
        createdAt: new Date().toISOString(),
      };
      if (input.sourceNoteId) card.sourceNoteId = input.sourceNoteId;
      if (input.sourceExcerpt) card.sourceExcerpt = input.sourceExcerpt;
      if (input.sourceFolder) card.sourceFolder = input.sourceFolder;
      if (input.sourceFile) card.sourceFile = input.sourceFile;
      if (typeof input.sourceLine === 'number') card.sourceLine = input.sourceLine;
      if (input.tags && input.tags.length > 0) card.tags = input.tags;

      await writeFile(cardPath(id), encodeCardMarkdown(card), 'utf8');
      await writeReviewState(createInitialReviewState(id));
      return card;
    },

    async batchCreate(input, maxBatchSize = 40) {
      if (input.cards.length === 0) {
        throw new Error('batchCreate: cards array must be non-empty');
      }
      if (input.cards.length > maxBatchSize) {
        throw new Error(`batchCreate: cards.length ${input.cards.length} exceeds maxBatchSize ${maxBatchSize}`);
      }
      const created: FlashcardRecord[] = [];
      const skipped: FlashcardBatchSkip[] = [];
      for (const cardInput of input.cards) {
        try {
          const card = await this.create(cardInput);
          created.push(card);
        } catch (error) {
          if (error instanceof DuplicateCardError) {
            skipped.push({ front: cardInput.front, reason: 'duplicate' });
          } else {
            skipped.push({
              front: cardInput.front,
              reason: 'validation',
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      return { created, skipped };
    },

    async list(filter) {
      const cards = await scanCards();
      return cards
        .filter((card) => {
          if (filter?.deck && card.deck !== filter.deck) return false;
          if (filter?.sourceNoteId && card.sourceNoteId !== filter.sourceNoteId) return false;
          if (filter?.sourceFolder && card.sourceFolder !== filter.sourceFolder) return false;
          return true;
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    async read(cardId) {
      const raw = await readFile(cardPath(cardId), 'utf8').catch(() => null);
      const card = raw ? decodeCardMarkdown(raw) : null;
      if (!card) {
        throw new Error(`card not found: ${cardId}`);
      }
      return card;
    },

    async delete(cardId) {
      await this.read(cardId); // throws when missing
      await rm(cardPath(cardId));
      await rm(reviewPath(cardId), { force: true });
      return { deleted: true, id: cardId };
    },

    async deleteBySourceFolder(folderPath) {
      const cards = await scanCards();
      const matching = cards.filter((card) => card.sourceFolder === folderPath);
      for (const card of matching) {
        await rm(cardPath(card.id));
        await rm(reviewPath(card.id), { force: true });
      }
      return { deleted: matching.length };
    },

    async rebindSourceFolder(oldPath, newPath) {
      const cards = await scanCards();
      const matching = cards.filter((card) => card.sourceFolder === oldPath);
      for (const card of matching) {
        const updated: FlashcardRecord = { ...card, sourceFolder: newPath };
        await writeFile(cardPath(card.id), encodeCardMarkdown(updated), 'utf8');
      }
      return { updated: matching.length };
    },

    async listDecks() {
      const cards = await scanCards();
      return [...new Set(cards.map((card) => card.deck))].sort();
    },

    async getReviewState(cardId) {
      const state = await readReviewState(cardId);
      if (state) return state;
      // Card exists but state file missing (e.g. user deleted it): re-init.
      await this.read(cardId);
      const initial = createInitialReviewState(cardId);
      await writeReviewState(initial);
      return initial;
    },

    async loadReviewStates() {
      const cards = await scanCards();
      const states = new Map<string, ReviewState>();
      for (const card of cards) {
        const state = await readReviewState(card.id);
        if (state) {
          states.set(card.id, state);
        } else {
          const initial = createInitialReviewState(card.id);
          await writeReviewState(initial);
          states.set(card.id, initial);
        }
      }
      return states;
    },

    async rate(cardId, rating, now) {
      const current = await this.getReviewState(cardId);
      const next = rateCard(current, rating, now);
      await writeReviewState(next);
      return next;
    },
  };
}
