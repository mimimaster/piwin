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

/**
 * Structured transcript display for flashcard create / batch-create results.
 * Reuses `FlashcardReviewCard` — no parallel card type.
 */
export type FlashcardDisplayPayload = {
  cards: FlashcardReviewCard[];
};

export type FlashcardCreateResult = {
  card: FlashcardItem;
  duplicate: boolean;
  display: FlashcardDisplayPayload;
};

/** Partial-success result of `flashcard_batch_create`. */
export type FlashcardBatchCreateResult = {
  created: FlashcardItem[];
  skipped: FlashcardBatchSkip[];
  /**
   * Flip cards for chat. Built from created items plus existing duplicates
   * so a physical card still shows when nothing new landed.
   */
  display: FlashcardDisplayPayload;
};

export function isFlashcardCreateToolName(name: string | undefined): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  return normalized.includes('flashcard_create') || normalized.includes('flashcard_batch_create');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === 'string');
  return items.length > 0 ? items : undefined;
}

function asReviewCard(value: unknown): FlashcardReviewCard | null {
  if (!isRecord(value)) return null;
  if (typeof value.cardId !== 'string' || !value.cardId.trim()) return null;
  if (typeof value.itemId !== 'string' || !value.itemId.trim()) return null;
  if (value.model !== 'basic' && value.model !== 'cloze') return null;
  if (typeof value.ordinal !== 'number' || !Number.isInteger(value.ordinal) || value.ordinal < 0) {
    return null;
  }
  if (typeof value.deck !== 'string' || !value.deck) return null;
  if (typeof value.front !== 'string' || !value.front.trim()) return null;
  if (typeof value.back !== 'string' || !value.back.trim()) return null;
  if (typeof value.createdAt !== 'string' || !value.createdAt) return null;
  const card: FlashcardReviewCard = {
    cardId: value.cardId,
    itemId: value.itemId,
    model: value.model,
    ordinal: value.ordinal,
    deck: value.deck,
    front: value.front,
    back: value.back,
    createdAt: value.createdAt,
  };
  const sourceNoteId = readOptionalString(value.sourceNoteId);
  if (sourceNoteId) card.sourceNoteId = sourceNoteId;
  const sourceHash = readOptionalString(value.sourceHash);
  if (sourceHash) card.sourceHash = sourceHash;
  const sourceExcerpt = readOptionalString(value.sourceExcerpt);
  if (sourceExcerpt) card.sourceExcerpt = sourceExcerpt;
  const sourceFolder = readOptionalString(value.sourceFolder);
  if (sourceFolder) card.sourceFolder = sourceFolder;
  const sourceFile = readOptionalString(value.sourceFile);
  if (sourceFile) card.sourceFile = sourceFile;
  if (typeof value.sourceLine === 'number' && Number.isFinite(value.sourceLine)) {
    card.sourceLine = value.sourceLine;
  }
  const tags = readStringArray(value.tags);
  if (tags) card.tags = tags;
  const sequenceId = readOptionalString(value.sequenceId);
  if (sequenceId) card.sequenceId = sequenceId;
  if (typeof value.position === 'number' && Number.isFinite(value.position)) {
    card.position = value.position;
  }
  const cardType = readOptionalString(value.cardType);
  if (cardType) card.cardType = cardType;
  const relationFromPrevious = readOptionalString(value.relationFromPrevious);
  if (relationFromPrevious) card.relationFromPrevious = relationFromPrevious;
  const knowledgePointIds = readStringArray(value.knowledgePointIds);
  if (knowledgePointIds) card.knowledgePointIds = knowledgePointIds;
  const sourceChunkIds = readStringArray(value.sourceChunkIds);
  if (sourceChunkIds) card.sourceChunkIds = sourceChunkIds;
  const generationId = readOptionalString(value.generationId);
  if (generationId) card.generationId = generationId;
  const sourceDocumentIds = readStringArray(value.sourceDocumentIds);
  if (sourceDocumentIds) card.sourceDocumentIds = sourceDocumentIds;
  return card;
}

function reviewCardsFromUnknown(value: unknown): FlashcardReviewCard[] {
  if (!Array.isArray(value)) return [];
  const cards: FlashcardReviewCard[] = [];
  for (const entry of value) {
    const card = asReviewCard(entry);
    if (card) cards.push(card);
  }
  return cards;
}

/**
 * Parse a flashcard tool result (JSON string or object) into display cards.
 * Ordinary HTML, including `data-card-id`, is not a display payload.
 */
export function parseFlashcardDisplayPayload(value: unknown): FlashcardDisplayPayload | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return parseFlashcardDisplayPayload(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  if (value.display !== undefined) {
    const nested = parseFlashcardDisplayPayload(value.display);
    if (nested) return nested;
  }
  const cards = reviewCardsFromUnknown(value.cards);
  return cards.length > 0 ? { cards } : null;
}

/** CLI / Mobile structured-text projection. Not a Desktop renderer. */
export function formatFlashcardDisplayText(payload: FlashcardDisplayPayload): string {
  return payload.cards
    .map((card, index) => {
      const prefix = payload.cards.length > 1 ? `${index + 1}. ` : '';
      return `${prefix}Q: ${card.front}\nA: ${card.back}`;
    })
    .join('\n\n');
}

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
