/**
 * Flashcards contracts (FSRS spaced repetition over agent-generated cards).
 * See docs/adr/0018-notes-flashcards-local-rag.md.
 *
 * Invariants: card markdown and review-state JSON under `~/.piwin/flashcards/`
 * are user data (never sqlite-only). Cards snapshot their source; note edits
 * never cascade.
 */

export type FlashcardRecord = {
  id: string;
  deck: string;
  front: string;
  back: string;
  sourceNoteId?: string;
  /** Note contentHash at generation time; divergence = "source updated" badge. */
  sourceHash?: string;
  /** Snapshot excerpt; card survives note edits/deletion. */
  sourceExcerpt?: string;
  tags?: string[];
  createdAt: string;
};

export type FlashcardCreateInput = {
  deck?: string;
  front: string;
  back: string;
  sourceNoteId?: string;
  sourceExcerpt?: string;
  tags?: string[];
};

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

/** FSRS scheduling state; persisted as JSON per card (user data, not cache). */
export type ReviewState = {
  cardId: string;
  /** ISO datetime the card becomes due. */
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReviewedAt?: string;
};

export type ReviewQueueItem = {
  card: FlashcardRecord;
  state: ReviewState;
  /** True when the card has never been reviewed. */
  isNew: boolean;
};

export type FlashcardsConfig = {
  /** Default true. */
  enabled?: boolean;
  /** New cards introduced per day; default 20. */
  newPerDay?: number;
  /** Review cap per day; default 200. */
  maxReviewsPerDay?: number;
};
