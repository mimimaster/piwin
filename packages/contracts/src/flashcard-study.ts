/**
 * Flashcard study-round contracts (review workbench).
 * Field names follow docs/specs/2026-08-30-flashcard-review-workbench-spec.md §8.
 */
import { PiwinError } from './piwin-error.js';
import type { FlashcardModel, ReviewState } from './flashcards.js';

export const FLASHCARD_STUDY_ROUND_SCHEMA_VERSION = 1 as const;

export type FlashcardStudyMode = 'sequence' | 'scheduled';
export type FlashcardStudyFace = 'question' | 'answer';
export type FlashcardStudyRoundStatus = 'active' | 'paused' | 'completed' | 'ended';
export type FlashcardStudyEntryState = 'pending' | 'processed' | 'invalidated';

export type FlashcardStudyScope =
  | { kind: 'item'; itemId: string }
  | { kind: 'sequence'; sequenceId: string }
  | { kind: 'selection'; parentRoundId: string; itemIds: string[] }
  | { kind: 'all' }
  | { kind: 'deck'; deck: string };

export type FlashcardStudyEntry = {
  entryId: string;
  itemId: string;
  /** Scheduled ReviewCard identity. Absent in sequence mode. */
  cardId?: string;
  /** Scheduled cloze ordinal. Absent in sequence mode. */
  ordinal?: number;
  /** ReviewState.revision observed when the entry was captured / last refreshed. */
  reviewStateRevision?: number;
  contentVersion: string;
  capturedPosition?: number;
  state: FlashcardStudyEntryState;
  needsReview: boolean;
};

export type FlashcardStudyCounts = {
  total: number;
  processed: number;
  invalidated: number;
  remaining: number;
};

export type FlashcardStudyRound = {
  roundId: string;
  schemaVersion: number;
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  status: FlashcardStudyRoundStatus;
  revision: number;
  controlEpoch: number;
  controllerIdentity: string;
  createdAt: string;
  updatedAt: string;
  entries: FlashcardStudyEntry[];
  currentEntryId: string | null;
  face: FlashcardStudyFace;
  lastAdvanceOperationId: string | null;
};

export type FlashcardStudyRoundSummary = {
  roundId: string;
  schemaVersion: number;
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  status: FlashcardStudyRoundStatus;
  revision: number;
  controlEpoch: number;
  controllerIdentity: string;
  createdAt: string;
  updatedAt: string;
  currentEntryId: string | null;
  face: FlashcardStudyFace;
  lastAdvanceOperationId: string | null;
};

/** Current-card projection. Next-shell metadata must not include answers. */
export type FlashcardStudyContentProjection = {
  entryId: string;
  itemId: string;
  cardId?: string;
  ordinal?: number;
  contentVersion: string;
  model: FlashcardModel;
  deck: string;
  face: FlashcardStudyFace;
  front: string;
  back?: string;
  needsReview: boolean;
  siblingOrdinal?: number;
  siblingCount?: number;
  sourceTitle?: string;
  sourceExcerpt?: string;
  tags?: string[];
  sequenceId?: string;
  /** Scheduled ReviewState.revision observed for this entry. */
  reviewStateRevision?: number;
};

export type FlashcardStudyNextShell = {
  entryId: string;
  itemId: string;
  cardId?: string;
  ordinal?: number;
  contentVersion: string;
};

export type FlashcardStudyAccessState = {
  hasControl: boolean;
  controllerIdentity: string;
  controlEpoch: number;
};

export type FlashcardStudySnapshot = {
  round: FlashcardStudyRoundSummary;
  current?: FlashcardStudyContentProjection;
  nextShell?: FlashcardStudyNextShell;
  counts: FlashcardStudyCounts;
  canUndo: boolean;
  nextDueAt?: string;
  access: FlashcardStudyAccessState;
};

export type FlashcardStudyUndoImage = {
  round: FlashcardStudyRound;
  reviewState?: ReviewState;
};

export type FlashcardStudyOperationResult =
  | { status: 'success'; snapshot: FlashcardStudySnapshot }
  | { status: 'rejected'; error: string; code: string }
  | { status: 'not-found' };

export type FlashcardStudyOperation = {
  idempotencyKey: string;
  payloadDigest: string;
  hostTimestamp: string;
  beforeRevision: number;
  afterRevision: number;
  result: FlashcardStudyOperationResult;
  undoBefore?: FlashcardStudyUndoImage;
  undoAfter?: FlashcardStudyUndoImage;
  reviewStateRevisionBefore?: number;
  reviewStateRevisionAfter?: number;
};

export type FlashcardStudyTileKind = 'single' | 'set';

export type FlashcardStudyTileSummary = {
  kind: FlashcardStudyTileKind;
  id: string;
  count: number;
  preview: string;
  sequenceId?: string;
  deck?: string;
};

export type FlashcardStudyUnfinishedRoundSummary = {
  roundId: string;
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  status: 'active' | 'paused';
  revision: number;
  updatedAt: string;
  counts: FlashcardStudyCounts;
};

export type FlashcardStudyCatalogPage = {
  tiles: FlashcardStudyTileSummary[];
  dueCount: number;
  newCount: number;
  unfinishedRounds: FlashcardStudyUnfinishedRoundSummary[];
  cursor?: string;
  nextCursor?: string;
};

const SEQUENCE_SCOPE_KINDS: ReadonlySet<FlashcardStudyScope['kind']> = new Set([
  'item',
  'sequence',
  'selection',
]);
const SCHEDULED_SCOPE_KINDS: ReadonlySet<FlashcardStudyScope['kind']> = new Set(['all', 'deck']);

export function isFlashcardStudyModeScopeCompatible(
  mode: FlashcardStudyMode,
  scope: FlashcardStudyScope,
): boolean {
  if (mode === 'sequence') return SEQUENCE_SCOPE_KINDS.has(scope.kind);
  return SCHEDULED_SCOPE_KINDS.has(scope.kind);
}

export function computeFlashcardStudyCounts(
  entries: readonly FlashcardStudyEntry[],
): FlashcardStudyCounts {
  let processed = 0;
  let invalidated = 0;
  for (const entry of entries) {
    if (entry.state === 'processed') processed += 1;
    else if (entry.state === 'invalidated') invalidated += 1;
  }
  const total = entries.length;
  return { total, processed, invalidated, remaining: total - processed - invalidated };
}

export function validateFlashcardStudyCounts(counts: FlashcardStudyCounts): string[] {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(counts) as Array<[keyof FlashcardStudyCounts, number]>) {
    if (!Number.isSafeInteger(value)) {
      issues.push(`${key} must be a safe integer`);
    }
  }
  if (counts.total < 0) issues.push('total must be >= 0');
  if (counts.processed < 0) issues.push('processed must be >= 0');
  if (counts.invalidated < 0) issues.push('invalidated must be >= 0');
  if (counts.remaining < 0) issues.push('remaining must be >= 0');
  if (counts.processed > counts.total) issues.push('processed exceeds total');
  if (counts.invalidated > counts.total) issues.push('invalidated exceeds total');
  if (counts.processed + counts.invalidated > counts.total) {
    issues.push('processed + invalidated exceeds total');
  }
  const expectedRemaining = counts.total - counts.processed - counts.invalidated;
  if (counts.remaining !== expectedRemaining) {
    issues.push(`remaining must equal total - processed - invalidated (${expectedRemaining})`);
  }
  return issues;
}

export function validateFlashcardStudyRound(round: FlashcardStudyRound): string[] {
  const issues: string[] = [];
  if (round.schemaVersion !== FLASHCARD_STUDY_ROUND_SCHEMA_VERSION) {
    issues.push(`unsupported schemaVersion ${round.schemaVersion}`);
  }
  if (!isFlashcardStudyModeScopeCompatible(round.mode, round.scope)) {
    issues.push('illegal mode-scope combination');
  }
  if (round.revision < 0 || !Number.isSafeInteger(round.revision)) {
    issues.push('revision must be a non-negative integer');
  }
  if (round.controlEpoch < 0 || !Number.isSafeInteger(round.controlEpoch)) {
    issues.push('controlEpoch must be a non-negative integer');
  }
  const ids = new Set<string>();
  for (const entry of round.entries) {
    if (ids.has(entry.entryId)) issues.push(`duplicate entryId ${entry.entryId}`);
    ids.add(entry.entryId);
    if (round.mode === 'sequence' && (entry.cardId !== undefined || entry.ordinal !== undefined)) {
      issues.push(`sequence entry ${entry.entryId} must not carry ReviewCard identity`);
    }
    if (round.mode === 'scheduled' && (entry.cardId === undefined || entry.ordinal === undefined)) {
      issues.push(`scheduled entry ${entry.entryId} requires cardId and ordinal`);
    }
  }
  if (round.currentEntryId !== null && !ids.has(round.currentEntryId)) {
    issues.push('current entry is missing from the round');
  }
  issues.push(...validateFlashcardStudyCounts(computeFlashcardStudyCounts(round.entries)));
  return issues;
}

export class StudyRoundNotFoundError extends PiwinError {
  readonly roundId: string;

  constructor(roundId: string) {
    super('StudyRoundNotFoundError', `Study round "${roundId}" was not found.`, {
      category: 'not-found',
    });
    this.roundId = roundId;
  }
}

export class StudyRevisionConflictError extends PiwinError {
  readonly roundId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(roundId: string, expectedRevision: number, actualRevision: number) {
    super(
      'StudyRevisionConflictError',
      `Study round "${roundId}" revision ${actualRevision} does not match expected ${expectedRevision}.`,
      { category: 'validation' },
    );
    this.roundId = roundId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class StudyControlLostError extends PiwinError {
  readonly roundId: string;

  constructor(roundId: string) {
    super('StudyControlLostError', `Study round "${roundId}" is controlled by another device.`, {
      category: 'permission',
    });
    this.roundId = roundId;
  }
}

export class StudyContentChangedError extends PiwinError {
  readonly entryId: string;

  constructor(entryId: string) {
    super(
      'StudyContentChangedError',
      `Study entry "${entryId}" content changed; return to the question face.`,
      { category: 'validation' },
    );
    this.entryId = entryId;
  }
}

export class StudyUndoConflictError extends PiwinError {
  readonly roundId: string;

  constructor(roundId: string, detail?: string) {
    super(
      'StudyUndoConflictError',
      detail
        ? `Study round "${roundId}" cannot undo: ${detail}`
        : `Study round "${roundId}" cannot undo the last advance.`,
      { category: 'validation' },
    );
    this.roundId = roundId;
  }
}

export class StudyOperationConflictError extends PiwinError {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      'StudyOperationConflictError',
      `Study operation key "${idempotencyKey}" was already used with a different payload.`,
      { category: 'validation' },
    );
    this.idempotencyKey = idempotencyKey;
  }
}

export class StudyStorageError extends PiwinError {
  constructor(detail: string) {
    super('StudyStorageError', `Study storage failed: ${detail}`, {
      category: 'execution',
    });
  }
}
