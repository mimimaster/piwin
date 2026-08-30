import type { ReviewRating } from './flashcards.js';
import {
  isFlashcardStudyModeScopeCompatible,
  type FlashcardStudyFace,
  type FlashcardStudyMode,
  type FlashcardStudyScope,
} from './flashcard-study.js';

export const FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT = 50;
export const FLASHCARD_STUDY_CATALOG_MAX_LIMIT = 100;
export const FLASHCARD_STUDY_ID_MAX_LENGTH = 256;
export const FLASHCARD_STUDY_QUERY_MAX_LENGTH = 256;

const STUDY_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const RATINGS: ReadonlySet<ReviewRating> = new Set(['again', 'hard', 'good', 'easy']);
const FACES: ReadonlySet<FlashcardStudyFace> = new Set(['question', 'answer']);
const MODES: ReadonlySet<FlashcardStudyMode> = new Set(['sequence', 'scheduled']);

export const FLASHCARD_STUDY_COMMAND_TYPES = [
  'flashcards/study/catalog',
  'flashcards/study/start',
  'flashcards/study/get',
  'flashcards/study/claim',
  'flashcards/study/checkpoint',
  'flashcards/study/next',
  'flashcards/study/rate',
  'flashcards/study/undo',
  'flashcards/study/pause',
  'flashcards/study/resume',
  'flashcards/study/end',
  'flashcards/study/operation',
] as const;

export type FlashcardStudyCommandType = (typeof FLASHCARD_STUDY_COMMAND_TYPES)[number];

export const FLASHCARD_STUDY_MUTATION_TYPES = [
  'flashcards/study/start',
  'flashcards/study/claim',
  'flashcards/study/checkpoint',
  'flashcards/study/next',
  'flashcards/study/rate',
  'flashcards/study/undo',
  'flashcards/study/pause',
  'flashcards/study/resume',
  'flashcards/study/end',
] as const satisfies readonly FlashcardStudyCommandType[];

export type FlashcardStudyMutationType = (typeof FLASHCARD_STUDY_MUTATION_TYPES)[number];

export type FlashcardStudyParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type FlashcardStudyCatalogCommand = {
  id?: string;
  type: 'flashcards/study/catalog';
  scopeFilter?: FlashcardStudyScope;
  query?: string;
  cursor?: string;
  limit: number;
};

export type FlashcardStudyStartCommand = {
  id?: string;
  type: 'flashcards/study/start';
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  resumeExisting: boolean;
};

export type FlashcardStudyGetCommand = {
  id?: string;
  type: 'flashcards/study/get';
  roundId: string;
};

export type FlashcardStudyClaimCommand = {
  id?: string;
  type: 'flashcards/study/claim';
  roundId: string;
  expectedRevision: number;
  expectedControlEpoch: number;
};

export type FlashcardStudyCheckpointCommand = {
  id?: string;
  type: 'flashcards/study/checkpoint';
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
  entryId: string;
  contentVersion: string;
  face: FlashcardStudyFace;
  needsReview?: boolean;
};

export type FlashcardStudyNextCommand = {
  id?: string;
  type: 'flashcards/study/next';
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
  entryId: string;
  contentVersion: string;
};

export type FlashcardStudyRateCommand = {
  id?: string;
  type: 'flashcards/study/rate';
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
  entryId: string;
  contentVersion: string;
  rating: ReviewRating;
  expectedReviewStateRevision: number;
};

export type FlashcardStudyUndoCommand = {
  id?: string;
  type: 'flashcards/study/undo';
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
  targetOperationId: string;
};

export type FlashcardStudyPauseCommand = {
  id?: string;
  type: 'flashcards/study/pause';
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
};

export type FlashcardStudyResumeCommand = {
  id?: string;
  type: 'flashcards/study/resume';
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
};

export type FlashcardStudyEndCommand = {
  id?: string;
  type: 'flashcards/study/end';
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
};

export type FlashcardStudyOperationCommand = {
  id?: string;
  type: 'flashcards/study/operation';
  idempotencyKey: string;
};

export type FlashcardStudyHostCommand =
  | FlashcardStudyCatalogCommand
  | FlashcardStudyStartCommand
  | FlashcardStudyGetCommand
  | FlashcardStudyClaimCommand
  | FlashcardStudyCheckpointCommand
  | FlashcardStudyNextCommand
  | FlashcardStudyRateCommand
  | FlashcardStudyUndoCommand
  | FlashcardStudyPauseCommand
  | FlashcardStudyResumeCommand
  | FlashcardStudyEndCommand
  | FlashcardStudyOperationCommand;

export function isFlashcardStudyCommandType(type: string): type is FlashcardStudyCommandType {
  return (FLASHCARD_STUDY_COMMAND_TYPES as readonly string[]).includes(type);
}

export function isPathLikeFlashcardStudyId(value: string): boolean {
  return (
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    /^[A-Za-z]:/.test(value)
  );
}

export function isFlashcardStudyId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= FLASHCARD_STUDY_ID_MAX_LENGTH &&
    STUDY_ID_PATTERN.test(value) &&
    !value.includes('..')
  );
}

export function parseFlashcardStudyCommand(
  value: unknown,
): FlashcardStudyParseResult<FlashcardStudyHostCommand> {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return fail('study command must be an object with a type');
  }
  const type = value.type;
  if (!isFlashcardStudyCommandType(type)) {
    return fail(`unknown study command ${type}`);
  }
  const id = parseOptionalCommandId(value.id);
  if (!id.ok) return id;
  switch (type) {
    case 'flashcards/study/catalog':
      return parseCatalog(value, id.value);
    case 'flashcards/study/start':
      return parseStart(value, id.value);
    case 'flashcards/study/get':
      return parseGet(value, id.value);
    case 'flashcards/study/claim':
      return parseClaim(value, id.value);
    case 'flashcards/study/checkpoint':
      return parseCheckpoint(value, id.value);
    case 'flashcards/study/next':
      return parseNext(value, id.value);
    case 'flashcards/study/rate':
      return parseRate(value, id.value);
    case 'flashcards/study/undo':
      return parseUndo(value, id.value);
    case 'flashcards/study/pause':
      return parseEpochCommand(value, id.value, 'flashcards/study/pause');
    case 'flashcards/study/resume':
      return parseEpochCommand(value, id.value, 'flashcards/study/resume');
    case 'flashcards/study/end':
      return parseEpochCommand(value, id.value, 'flashcards/study/end');
    case 'flashcards/study/operation':
      return parseOperation(value, id.value);
  }
}

function parseCatalog(
  value: Record<string, unknown>,
  id: string | undefined,
): FlashcardStudyParseResult<FlashcardStudyCatalogCommand> {
  const limit = parseCatalogLimit(value.limit);
  if (!limit.ok) return limit;
  let scopeFilter: FlashcardStudyScope | undefined;
  if (value.scopeFilter !== undefined) {
    const parsed = parseFlashcardStudyScope(value.scopeFilter);
    if (!parsed.ok) return parsed;
    scopeFilter = parsed.value;
  }
  let query: string | undefined;
  if (value.query !== undefined) {
    if (typeof value.query !== 'string') return fail('catalog query must be a string');
    if (value.query.length > FLASHCARD_STUDY_QUERY_MAX_LENGTH) {
      return fail('catalog query is too long');
    }
    query = value.query;
  }
  let cursor: string | undefined;
  if (value.cursor !== undefined) {
    const parsed = parseStudyId(value.cursor, 'cursor');
    if (!parsed.ok) return parsed;
    cursor = parsed.value;
  }
  return ok({
    ...withId(id),
    type: 'flashcards/study/catalog',
    ...(scopeFilter ? { scopeFilter } : {}),
    ...(query !== undefined ? { query } : {}),
    ...(cursor ? { cursor } : {}),
    limit: limit.value,
  });
}

function parseStart(
  value: Record<string, unknown>,
  id: string | undefined,
): FlashcardStudyParseResult<FlashcardStudyStartCommand> {
  const mode = parseMode(value.mode);
  if (!mode.ok) return mode;
  const scope = parseFlashcardStudyScope(value.scope);
  if (!scope.ok) return scope;
  if (!isFlashcardStudyModeScopeCompatible(mode.value, scope.value)) {
    return fail('illegal mode-scope combination');
  }
  let resumeExisting = true;
  if (value.resumeExisting !== undefined) {
    if (typeof value.resumeExisting !== 'boolean') {
      return fail('resumeExisting must be a boolean');
    }
    resumeExisting = value.resumeExisting;
  }
  return ok({
    ...withId(id),
    type: 'flashcards/study/start',
    mode: mode.value,
    scope: scope.value,
    resumeExisting,
  });
}

function parseGet(
  value: Record<string, unknown>,
  id: string | undefined,
): FlashcardStudyParseResult<FlashcardStudyGetCommand> {
  const roundId = parseStudyId(value.roundId, 'roundId');
  if (!roundId.ok) return roundId;
  return ok({ ...withId(id), type: 'flashcards/study/get', roundId: roundId.value });
}

function parseClaim(
  value: Record<string, unknown>,
  id: string | undefined,
): FlashcardStudyParseResult<FlashcardStudyClaimCommand> {
  const roundId = parseStudyId(value.roundId, 'roundId');
  if (!roundId.ok) return roundId;
  const expectedRevision = parseNonNegativeInt(value.expectedRevision, 'expectedRevision');
  if (!expectedRevision.ok) return expectedRevision;
  const expectedControlEpoch = parseNonNegativeInt(
    value.expectedControlEpoch,
    'expectedControlEpoch',
  );
  if (!expectedControlEpoch.ok) return expectedControlEpoch;
  return ok({
    ...withId(id),
    type: 'flashcards/study/claim',
    roundId: roundId.value,
    expectedRevision: expectedRevision.value,
    expectedControlEpoch: expectedControlEpoch.value,
  });
}

function parseCheckpoint(
  value: Record<string, unknown>,
  id: string | undefined,
): FlashcardStudyParseResult<FlashcardStudyCheckpointCommand> {
  const base = parseAdvanceBase(value);
  if (!base.ok) return base;
  const face = parseFace(value.face);
  if (!face.ok) return face;
  let needsReview: boolean | undefined;
  if (value.needsReview !== undefined) {
    if (typeof value.needsReview !== 'boolean') return fail('needsReview must be a boolean');
    needsReview = value.needsReview;
  }
  return ok({
    ...withId(id),
    type: 'flashcards/study/checkpoint',
    ...base.value,
    face: face.value,
    ...(needsReview !== undefined ? { needsReview } : {}),
  });
}

function parseNext(
  value: Record<string, unknown>,
  id: string | undefined,
): FlashcardStudyParseResult<FlashcardStudyNextCommand> {
  const base = parseAdvanceBase(value);
  if (!base.ok) return base;
  return ok({ ...withId(id), type: 'flashcards/study/next', ...base.value });
}

function parseRate(
  value: Record<string, unknown>,
  id: string | undefined,
): FlashcardStudyParseResult<FlashcardStudyRateCommand> {
  const base = parseAdvanceBase(value);
  if (!base.ok) return base;
  const rating = parseRating(value.rating);
  if (!rating.ok) return rating;
  const expectedReviewStateRevision = parseNonNegativeInt(
    value.expectedReviewStateRevision,
    'expectedReviewStateRevision',
  );
  if (!expectedReviewStateRevision.ok) return expectedReviewStateRevision;
  return ok({
    ...withId(id),
    type: 'flashcards/study/rate',
    ...base.value,
    rating: rating.value,
    expectedReviewStateRevision: expectedReviewStateRevision.value,
  });
}

function parseUndo(
  value: Record<string, unknown>,
  id: string | undefined,
): FlashcardStudyParseResult<FlashcardStudyUndoCommand> {
  const roundId = parseStudyId(value.roundId, 'roundId');
  if (!roundId.ok) return roundId;
  const expectedRevision = parseNonNegativeInt(value.expectedRevision, 'expectedRevision');
  if (!expectedRevision.ok) return expectedRevision;
  const controlEpoch = parseNonNegativeInt(value.controlEpoch, 'controlEpoch');
  if (!controlEpoch.ok) return controlEpoch;
  const targetOperationId = parseStudyId(value.targetOperationId, 'targetOperationId');
  if (!targetOperationId.ok) return targetOperationId;
  return ok({
    ...withId(id),
    type: 'flashcards/study/undo',
    roundId: roundId.value,
    expectedRevision: expectedRevision.value,
    controlEpoch: controlEpoch.value,
    targetOperationId: targetOperationId.value,
  });
}

function parseEpochCommand(
  value: Record<string, unknown>,
  id: string | undefined,
  type: 'flashcards/study/pause' | 'flashcards/study/resume' | 'flashcards/study/end',
): FlashcardStudyParseResult<
  FlashcardStudyPauseCommand | FlashcardStudyResumeCommand | FlashcardStudyEndCommand
> {
  const roundId = parseStudyId(value.roundId, 'roundId');
  if (!roundId.ok) return roundId;
  const expectedRevision = parseNonNegativeInt(value.expectedRevision, 'expectedRevision');
  if (!expectedRevision.ok) return expectedRevision;
  const controlEpoch = parseNonNegativeInt(value.controlEpoch, 'controlEpoch');
  if (!controlEpoch.ok) return controlEpoch;
  return ok({
    ...withId(id),
    type,
    roundId: roundId.value,
    expectedRevision: expectedRevision.value,
    controlEpoch: controlEpoch.value,
  });
}

function parseOperation(
  value: Record<string, unknown>,
  id: string | undefined,
): FlashcardStudyParseResult<FlashcardStudyOperationCommand> {
  const idempotencyKey = parseStudyId(value.idempotencyKey, 'idempotencyKey');
  if (!idempotencyKey.ok) return idempotencyKey;
  return ok({
    ...withId(id),
    type: 'flashcards/study/operation',
    idempotencyKey: idempotencyKey.value,
  });
}

export function parseFlashcardStudyScope(
  value: unknown,
): FlashcardStudyParseResult<FlashcardStudyScope> {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return fail('scope must be a discriminated object');
  }
  switch (value.kind) {
    case 'item': {
      const itemId = parseStudyId(value.itemId, 'itemId');
      if (!itemId.ok) return itemId;
      return ok({ kind: 'item', itemId: itemId.value });
    }
    case 'sequence': {
      const sequenceId = parseStudyId(value.sequenceId, 'sequenceId');
      if (!sequenceId.ok) return sequenceId;
      return ok({ kind: 'sequence', sequenceId: sequenceId.value });
    }
    case 'selection': {
      const parentRoundId = parseStudyId(value.parentRoundId, 'parentRoundId');
      if (!parentRoundId.ok) return parentRoundId;
      if (!Array.isArray(value.itemIds) || value.itemIds.length === 0) {
        return fail('selection itemIds must be a non-empty array');
      }
      const itemIds: string[] = [];
      const seen = new Set<string>();
      for (const entry of value.itemIds) {
        const itemId = parseStudyId(entry, 'itemId');
        if (!itemId.ok) return itemId;
        if (seen.has(itemId.value)) return fail('selection itemIds must be unique');
        seen.add(itemId.value);
        itemIds.push(itemId.value);
      }
      return ok({ kind: 'selection', parentRoundId: parentRoundId.value, itemIds });
    }
    case 'all':
      return ok({ kind: 'all' });
    case 'deck': {
      const deck = parseDeck(value.deck);
      if (!deck.ok) return deck;
      return ok({ kind: 'deck', deck: deck.value });
    }
    default:
      return fail(`unknown scope kind ${value.kind}`);
  }
}

export function parseCatalogLimit(value: unknown): FlashcardStudyParseResult<number> {
  if (value === undefined) return ok(FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return fail('catalog limit must be a positive integer');
  }
  return ok(Math.min(value, FLASHCARD_STUDY_CATALOG_MAX_LIMIT));
}

function parseAdvanceBase(value: Record<string, unknown>): FlashcardStudyParseResult<{
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
  entryId: string;
  contentVersion: string;
}> {
  const roundId = parseStudyId(value.roundId, 'roundId');
  if (!roundId.ok) return roundId;
  const expectedRevision = parseNonNegativeInt(value.expectedRevision, 'expectedRevision');
  if (!expectedRevision.ok) return expectedRevision;
  const controlEpoch = parseNonNegativeInt(value.controlEpoch, 'controlEpoch');
  if (!controlEpoch.ok) return controlEpoch;
  const entryId = parseStudyId(value.entryId, 'entryId');
  if (!entryId.ok) return entryId;
  const contentVersion = parseStudyId(value.contentVersion, 'contentVersion');
  if (!contentVersion.ok) return contentVersion;
  return ok({
    roundId: roundId.value,
    expectedRevision: expectedRevision.value,
    controlEpoch: controlEpoch.value,
    entryId: entryId.value,
    contentVersion: contentVersion.value,
  });
}

function parseMode(value: unknown): FlashcardStudyParseResult<FlashcardStudyMode> {
  if (typeof value !== 'string' || !MODES.has(value as FlashcardStudyMode)) {
    return fail('mode must be sequence or scheduled');
  }
  return ok(value as FlashcardStudyMode);
}

function parseFace(value: unknown): FlashcardStudyParseResult<FlashcardStudyFace> {
  if (typeof value !== 'string' || !FACES.has(value as FlashcardStudyFace)) {
    return fail('face must be question or answer');
  }
  return ok(value as FlashcardStudyFace);
}

function parseRating(value: unknown): FlashcardStudyParseResult<ReviewRating> {
  if (typeof value !== 'string' || !RATINGS.has(value as ReviewRating)) {
    return fail('rating must be again, hard, good, or easy');
  }
  return ok(value as ReviewRating);
}

function parseStudyId(value: unknown, field: string): FlashcardStudyParseResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(`${field} must be a non-empty string`);
  }
  if (isPathLikeFlashcardStudyId(value) || !isFlashcardStudyId(value)) {
    return fail(`${field} is not a valid study id`);
  }
  return ok(value);
}

function parseDeck(value: unknown): FlashcardStudyParseResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail('deck must be a non-empty string');
  }
  if (isPathLikeFlashcardStudyId(value) || value.length > FLASHCARD_STUDY_ID_MAX_LENGTH) {
    return fail('deck is not a valid study id');
  }
  return ok(value);
}

function parseNonNegativeInt(value: unknown, field: string): FlashcardStudyParseResult<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(`${field} must be a non-negative integer`);
  }
  return ok(value);
}

function parseOptionalCommandId(value: unknown): FlashcardStudyParseResult<string | undefined> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail('id must be a non-empty string');
  }
  return ok(value);
}

function withId(id: string | undefined): { id?: string } {
  return id === undefined ? {} : { id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ok<T>(value: T): FlashcardStudyParseResult<T> {
  return { ok: true, value };
}

function fail(error: string): FlashcardStudyParseResult<never> {
  return { ok: false, error };
}
