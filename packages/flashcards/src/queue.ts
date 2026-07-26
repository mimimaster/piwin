/**
 * Review queue building (pure): due cards first (oldest due first), then new
 * cards capped by `newPerDay`, total capped by `maxReviewsPerDay`.
 */
import type { FlashcardRecord, ReviewQueueItem, ReviewState } from '@piwin/contracts';
import { isNewState } from './scheduler.js';

export type BuildQueueInput = {
  cards: FlashcardRecord[];
  states: Map<string, ReviewState>;
  now?: Date;
  /** Default 20. */
  newPerDay?: number;
  /** Default 200. */
  maxReviewsPerDay?: number;
  deck?: string;
};

export function buildReviewQueue(input: BuildQueueInput): ReviewQueueItem[] {
  const now = input.now ?? new Date();
  const newPerDay = input.newPerDay ?? 20;
  const maxReviews = input.maxReviewsPerDay ?? 200;

  const due: ReviewQueueItem[] = [];
  const fresh: ReviewQueueItem[] = [];

  for (const card of input.cards) {
    if (input.deck && card.deck !== input.deck) continue;
    const state = input.states.get(card.id);
    if (!state) continue; // state missing → card not yet registered for review
    if (isNewState(state)) {
      fresh.push({ card, state, isNew: true });
    } else if (new Date(state.due) <= now) {
      due.push({ card, state, isNew: false });
    }
  }

  due.sort((left, right) => left.state.due.localeCompare(right.state.due));
  // New cards oldest-created first for stable ordering.
  fresh.sort((left, right) => left.card.createdAt.localeCompare(right.card.createdAt));

  return [...due, ...fresh.slice(0, newPerDay)].slice(0, maxReviews);
}
