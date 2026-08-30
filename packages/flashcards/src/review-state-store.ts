import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FlashcardItem, ReviewState } from '@piwin/contracts';
import { expandItemToReviewCards, parseReviewCardId, reviewStateFileName } from './cloze.js';
import { assertInsideFlashcardsRoot, sanitizeCardId } from './paths.js';
import { createInitialReviewState } from './scheduler.js';

export type ReviewStateStoreOptions = {
  flashcardsRoot: string;
  reviewDir: string;
  ensureDirs: () => Promise<void>;
};

export type ReviewStateStore = {
  read: (cardId: string) => Promise<ReviewState | null>;
  write: (state: ReviewState) => Promise<void>;
  deleteForItem: (itemId: string) => Promise<void>;
  ensureForItem: (item: FlashcardItem) => Promise<void>;
};

export function createReviewStateStore(options: ReviewStateStoreOptions): ReviewStateStore {
  const { flashcardsRoot, reviewDir, ensureDirs } = options;

  function reviewPath(cardId: string): string {
    const { itemId } = parseReviewCardId(cardId);
    sanitizeCardId(itemId);
    return assertInsideFlashcardsRoot(flashcardsRoot, join(reviewDir, reviewStateFileName(cardId)));
  }

  async function read(cardId: string): Promise<ReviewState | null> {
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

  async function write(state: ReviewState): Promise<void> {
    await ensureDirs();
    const path = reviewPath(state.cardId);
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tmpPath, path);
  }

  async function deleteForItem(itemId: string): Promise<void> {
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

  async function ensureForItem(item: FlashcardItem): Promise<void> {
    for (const card of expandItemToReviewCards(item)) {
      const existing = await read(card.cardId);
      if (!existing) {
        await write(createInitialReviewState(card.cardId));
      }
    }
  }

  return { read, write, deleteForItem, ensureForItem };
}
