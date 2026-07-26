/**
 * FSRS scheduling via ts-fsrs (MIT). Pure: (state, rating, now) → next state.
 * ReviewState is the persisted product shape (contracts); ts-fsrs Card is an
 * internal representation mapped at this boundary only.
 */
import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';
import type { ReviewRating, ReviewState } from '@piwin/contracts';

const scheduler = fsrs(); // default FSRS parameters

const RATING_MAP: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** Initial state for a card never reviewed: due immediately. */
export function createInitialReviewState(cardId: string, now: Date = new Date()): ReviewState {
  return {
    cardId,
    due: now.toISOString(),
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
  };
}

export function isNewState(state: ReviewState): boolean {
  return state.reps === 0;
}

/** Apply a rating; returns the next persisted state. */
export function rateCard(
  state: ReviewState,
  rating: ReviewRating,
  now: Date = new Date(),
): ReviewState {
  const fsrsCard = toFsrsCard(state, now);
  const result = scheduler.next(fsrsCard, now, RATING_MAP[rating]);
  const next = result.card;
  return {
    cardId: state.cardId,
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    reps: next.reps,
    lapses: next.lapses,
    lastReviewedAt: now.toISOString(),
  };
}

function toFsrsCard(state: ReviewState, now: Date): FsrsCard {
  if (isNewState(state)) {
    return createEmptyCard(now);
  }
  const lastReview = state.lastReviewedAt ? new Date(state.lastReviewedAt) : now;
  const due = new Date(state.due);
  const elapsedDays = Math.max(
    0,
    (now.getTime() - lastReview.getTime()) / (24 * 60 * 60 * 1000),
  );
  const scheduledDays = Math.max(
    0,
    (due.getTime() - lastReview.getTime()) / (24 * 60 * 60 * 1000),
  );
  return {
    due,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: elapsedDays,
    scheduled_days: scheduledDays,
    learning_steps: 0,
    reps: state.reps,
    lapses: state.lapses,
    // Once reviewed at least once we treat cards as in Review state;
    // FSRS learning steps are not persisted in the product shape (v1).
    state: State.Review,
    last_review: lastReview,
  };
}
