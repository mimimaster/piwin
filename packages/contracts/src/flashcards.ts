/**
 * Flashcards contracts (FSRS spaced repetition over agent-generated cards).
 * See docs/adr/0018-notes-flashcards-local-rag.md and
 * docs/superpowers/specs/2026-08-18-flashcard-models-basic-cloze-design.md.
 *
 * Invariants: item markdown and review-state JSON under `~/.piwin/flashcards/`
 * are user data (never sqlite-only). Items snapshot their source; note edits
 * never cascade. Review cards are derived from items at read time.
 */

export type FlashcardModel = 'basic' | 'cloze';

/** Shared source / RAG lineage fields (item, create input, review projection). */
export type FlashcardAttribution = {
  sourceNoteId?: string;
  /** Note contentHash at generation time; divergence = "source updated" badge. */
  sourceHash?: string;
  /** Snapshot excerpt; card survives note edits/deletion. */
  sourceExcerpt?: string;
  /**
   * Folder mode: absolute, canonicalized path of the folder the card was
   * generated from. See docs/specs/doc-flashcards.md §7.2.
   */
  sourceFolder?: string;
  /** Folder mode: relative path of the source file under `sourceFolder`. */
  sourceFile?: string;
  /** Folder mode: 1-based line in `sourceFile` the excerpt starts on. */
  sourceLine?: number;
  tags?: string[];
  /** RAG generation sequence; display order only, not FSRS. */
  sequenceId?: string;
  /** 1-based position within `sequenceId`. */
  position?: number;
  /** Knowledge tag (`fact` / `definition`); not the study model. */
  cardType?: string;
  relationFromPrevious?: string;
  knowledgePointIds?: string[];
  sourceChunkIds?: string[];
  generationId?: string;
  sourceDocumentIds?: string[];
};

/** Durable flashcard content on disk (`cards/<id>.md`). */
export type FlashcardItem = FlashcardAttribution & {
  id: string;
  model: FlashcardModel;
  deck: string;
  /** basic only. */
  front?: string;
  /** basic only. */
  back?: string;
  /** cloze only; Anki-style `{{cN::answer}}` markers. */
  text?: string;
  createdAt: string;
};

/** Derived study unit. FSRS keys off `cardId`. */
export type FlashcardReviewCard = FlashcardAttribution & {
  cardId: string;
  itemId: string;
  model: FlashcardModel;
  ordinal: number;
  deck: string;
  front: string;
  back: string;
  createdAt: string;
};

/**
 * @deprecated Use `FlashcardItem` (disk) or `FlashcardReviewCard` (study).
 * Alias kept so call sites can migrate mechanically.
 */
export type FlashcardRecord = FlashcardItem;

export type FlashcardCreateInput = FlashcardAttribution & {
  model?: FlashcardModel;
  front?: string;
  back?: string;
  text?: string;
  deck?: string;
};

/** Batch creation input — the schema `flashcard_batch_create` fills in. */
export type FlashcardBatchCreateInput = {
  cards: FlashcardCreateInput[];
};

/** A card that was rejected during batch creation. */
export type FlashcardBatchSkip = {
  /** Preview string: basic front, or cloze text with markers stripped. */
  front: string;
  reason: 'duplicate' | 'validation';
  detail?: string;
  /** Existing item when `reason` is `duplicate` — conversation still shows this card. */
  existing?: FlashcardItem;
};

/** Partial-success result of `flashcard_batch_create`. */
export type FlashcardBatchCreateResult = {
  created: FlashcardItem[];
  skipped: FlashcardBatchSkip[];
  /**
   * Combined flip-card HTML. Built from created items plus existing
   * duplicates so chat can show a physical card even when nothing new landed.
   */
  artifactHtml: string;
};

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

/** FSRS scheduling state; persisted as JSON per review card (user data, not cache). */
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
  card: FlashcardReviewCard;
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
  /** Max items per `flashcard_batch_create`. Default 40. */
  maxBatchSize?: number;
};
