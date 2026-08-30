/**
 * Unique mutation path for ReviewState writes. Callers must share the
 * flashcardsRoot coordinator; rate/init/delete take the serial lock.
 */
import {
  reviewStateRevision,
  type FlashcardItem,
  type ReviewRating,
  type ReviewState,
} from '@piwin/contracts';
import { expandItemToReviewCards, parseReviewCardId } from './cloze.js';
import { createInitialReviewState, rateCard } from './scheduler.js';
import type { StudyCoordinator } from './study-transaction.js';
import { wrapStorage } from './study-transaction.js';

export type ReviewWriteService = {
  read: (cardId: string) => Promise<ReviewState | null>;
  getOrInit: (cardId: string, now?: Date) => Promise<ReviewState>;
  ensureForItem: (item: FlashcardItem) => Promise<void>;
  rate: (cardId: string, rating: ReviewRating, now?: Date) => Promise<ReviewState>;
  applyTarget: (state: ReviewState) => Promise<void>;
  deleteForItem: (itemId: string) => Promise<void>;
};

export function incrementReviewRevision(state: ReviewState): ReviewState {
  return { ...state, revision: reviewStateRevision(state) + 1 };
}

export function applyRatingToReviewState(
  state: ReviewState,
  rating: ReviewRating,
  now: Date,
): ReviewState {
  return incrementReviewRevision(rateCard(state, rating, now));
}

export function createReviewWriteService(coordinator: StudyCoordinator): ReviewWriteService {
  const { reviewStates } = coordinator;

  async function read(cardId: string): Promise<ReviewState | null> {
    await coordinator.ensureRecovered();
    try {
      return await reviewStates.read(cardId);
    } catch (error) {
      throw wrapStorage(error);
    }
  }

  async function assertItemExists(cardId: string): Promise<void> {
    const { itemId } = parseReviewCardId(cardId);
    if (!(await coordinator.itemExists(itemId))) {
      throw new Error(`review card not found: ${cardId}`);
    }
  }

  async function getOrInitUnlocked(cardId: string, now?: Date): Promise<ReviewState> {
    await assertItemExists(cardId);
    const existing = await reviewStates.read(cardId);
    if (existing) return existing;
    const initial = createInitialReviewState(cardId, now ?? coordinator.now());
    await reviewStates.write(initial);
    return initial;
  }

  return {
    read,

    async getOrInit(cardId, now) {
      return coordinator.runExclusive(() => getOrInitUnlocked(cardId, now));
    },

    async ensureForItem(item) {
      await coordinator.runExclusive(async () => {
        for (const card of expandItemToReviewCards(item)) {
          await getOrInitUnlocked(card.cardId);
        }
      });
    },

    async rate(cardId, rating, now) {
      return coordinator.runExclusive(async () => {
        await assertItemExists(cardId);
        const current = await getOrInitUnlocked(cardId, now);
        const next = applyRatingToReviewState(current, rating, now ?? coordinator.now());
        await reviewStates.write(next);
        return next;
      });
    },

    async applyTarget(state) {
      return coordinator.runExclusive(() => coordinator.writeTargetReviewState(state));
    },

    async deleteForItem(itemId) {
      await coordinator.runExclusive(async () => {
        await reviewStates.deleteForItem(itemId);
      });
    },
  };
}
