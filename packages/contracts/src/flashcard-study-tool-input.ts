/**
 * Strict parsers for flashcard_study_read / flashcard_study_write tool inputs.
 * Scheduled MVP: all|deck scopes, no authority injection, no sequence/goto/next.
 */
import {
  parseFlashcardStudyCommand,
  parseFlashcardStudyScope,
  type FlashcardStudyParseResult,
} from './flashcard-study-commands.js';
import type { FlashcardStudyScope } from './flashcard-study.js';
import type {
  FlashcardStudyReadToolInput,
  FlashcardStudyScheduledStartScope,
  FlashcardStudyWriteToolInput,
} from './flashcard-study-tools.js';

// Local copies — do not import runtime values from flashcard-study-tools.js
// (tools imports this module; a value cycle leaves Sets empty at init).
const READ_ACTION_SET: ReadonlySet<string> = new Set(['catalog', 'get', 'operation']);
const WRITE_ACTION_SET: ReadonlySet<string> = new Set([
  'start',
  'claim',
  'checkpoint',
  'rate',
  'undo',
  'pause',
  'resume',
  'end',
]);
const FORBIDDEN_AUTHORITY_SET: ReadonlySet<string> = new Set([
  'type',
  'controllerIdentity',
  'principal',
  'sessionId',
  'runId',
  'runtimeGenerationId',
  'toolCallId',
  'toolName',
]);

const SCOPE_KEYS_BY_KIND: Readonly<Record<FlashcardStudyScope['kind'], readonly string[]>> = {
  item: ['kind', 'itemId'],
  sequence: ['kind', 'sequenceId'],
  selection: ['kind', 'parentRoundId', 'itemIds'],
  all: ['kind'],
  deck: ['kind', 'deck'],
};

const SCHEDULED_MVP_SCOPE_KINDS: ReadonlySet<string> = new Set(['all', 'deck']);

export function parseFlashcardStudyReadToolInputImpl(
  value: unknown,
): FlashcardStudyParseResult<FlashcardStudyReadToolInput> {
  const record = requirePlainObject(value);
  if (!record.ok) return record;
  const authority = rejectForbiddenAuthority(record.value);
  if (!authority.ok) return authority;

  const action = record.value.action;
  if (typeof action !== 'string' || !READ_ACTION_SET.has(action)) {
    return fail('action must be catalog, get, or operation');
  }

  switch (action) {
    case 'catalog':
      return parseReadCatalog(record.value);
    case 'get':
      return parseReadGet(record.value);
    case 'operation':
      return parseReadOperation(record.value);
    default:
      return fail('action must be catalog, get, or operation');
  }
}

export function parseFlashcardStudyWriteToolInputImpl(
  value: unknown,
): FlashcardStudyParseResult<FlashcardStudyWriteToolInput> {
  const record = requirePlainObject(value);
  if (!record.ok) return record;
  const authority = rejectForbiddenAuthority(record.value);
  if (!authority.ok) return authority;

  const action = record.value.action;
  if (typeof action !== 'string' || !WRITE_ACTION_SET.has(action)) {
    return fail(
      'action must be start, claim, checkpoint, rate, undo, pause, resume, or end',
    );
  }

  if (record.value.idempotencyKey === undefined) {
    return fail('idempotencyKey is required');
  }

  switch (action) {
    case 'start':
      return parseWriteStart(record.value);
    case 'claim':
      return parseWriteClaim(record.value);
    case 'checkpoint':
      return parseWriteCheckpoint(record.value);
    case 'rate':
      return parseWriteRate(record.value);
    case 'undo':
      return parseWriteUndo(record.value);
    case 'pause':
      return parseWriteEpoch(record.value, 'pause');
    case 'resume':
      return parseWriteEpoch(record.value, 'resume');
    case 'end':
      return parseWriteEpoch(record.value, 'end');
    default:
      return fail(
        'action must be start, claim, checkpoint, rate, undo, pause, resume, or end',
      );
  }
}

function parseReadCatalog(
  value: Record<string, unknown>,
): FlashcardStudyParseResult<FlashcardStudyReadToolInput> {
  const keys = assertAllowedKeys(value, [
    'action',
    'scopeFilter',
    'query',
    'cursor',
    'limit',
  ]);
  if (!keys.ok) return keys;

  let scopeFilter: FlashcardStudyScope | undefined;
  if (value.scopeFilter !== undefined) {
    const parsed = parseScheduledMvpScope(value.scopeFilter, 'scopeFilter');
    if (!parsed.ok) return parsed;
    scopeFilter = parsed.value;
  }

  const command = parseFlashcardStudyCommand({
    type: 'flashcards/study/catalog',
    ...(scopeFilter ? { scopeFilter } : {}),
    ...(value.query !== undefined ? { query: value.query } : {}),
    ...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
    ...(value.limit !== undefined ? { limit: value.limit } : {}),
  });
  if (!command.ok) return command;
  if (command.value.type !== 'flashcards/study/catalog') {
    return fail('internal catalog parse mismatch');
  }
  const { type: _type, id: _id, ...rest } = command.value;
  return ok({ action: 'catalog', ...rest });
}

function parseReadGet(
  value: Record<string, unknown>,
): FlashcardStudyParseResult<FlashcardStudyReadToolInput> {
  const keys = assertAllowedKeys(value, ['action', 'roundId']);
  if (!keys.ok) return keys;
  const command = parseFlashcardStudyCommand({
    type: 'flashcards/study/get',
    roundId: value.roundId,
  });
  if (!command.ok) return command;
  if (command.value.type !== 'flashcards/study/get') {
    return fail('internal get parse mismatch');
  }
  return ok({ action: 'get', roundId: command.value.roundId });
}

function parseReadOperation(
  value: Record<string, unknown>,
): FlashcardStudyParseResult<FlashcardStudyReadToolInput> {
  const keys = assertAllowedKeys(value, ['action', 'idempotencyKey']);
  if (!keys.ok) return keys;
  const command = parseFlashcardStudyCommand({
    type: 'flashcards/study/operation',
    idempotencyKey: value.idempotencyKey,
  });
  if (!command.ok) return command;
  if (command.value.type !== 'flashcards/study/operation') {
    return fail('internal operation parse mismatch');
  }
  return ok({ action: 'operation', idempotencyKey: command.value.idempotencyKey });
}

function parseWriteStart(
  value: Record<string, unknown>,
): FlashcardStudyParseResult<FlashcardStudyWriteToolInput> {
  const keys = assertAllowedKeys(value, [
    'action',
    'idempotencyKey',
    'mode',
    'scope',
    'resumeExisting',
  ]);
  if (!keys.ok) return keys;

  // Scheduled MVP: mode defaults to scheduled; any other value is illegal.
  let mode: 'scheduled' = 'scheduled';
  if (value.mode !== undefined) {
    if (value.mode !== 'scheduled') {
      return fail('mode must be scheduled');
    }
    mode = 'scheduled';
  }

  if (value.scope === undefined) {
    return fail('scope is required');
  }
  const scope = parseScheduledMvpScope(value.scope, 'scope');
  if (!scope.ok) return scope;

  const command = parseFlashcardStudyCommand({
    type: 'flashcards/study/start',
    mode,
    scope: scope.value,
    ...(value.resumeExisting !== undefined ? { resumeExisting: value.resumeExisting } : {}),
  });
  if (!command.ok) return command;
  if (command.value.type !== 'flashcards/study/start') {
    return fail('internal start parse mismatch');
  }

  const idempotencyKey = parseIdempotencyKey(value.idempotencyKey);
  if (!idempotencyKey.ok) return idempotencyKey;

  return ok({
    action: 'start',
    idempotencyKey: idempotencyKey.value,
    mode: 'scheduled',
    scope: command.value.scope as FlashcardStudyScheduledStartScope,
    resumeExisting: command.value.resumeExisting,
  });
}

function parseWriteClaim(
  value: Record<string, unknown>,
): FlashcardStudyParseResult<FlashcardStudyWriteToolInput> {
  const keys = assertAllowedKeys(value, [
    'action',
    'idempotencyKey',
    'roundId',
    'expectedRevision',
    'expectedControlEpoch',
  ]);
  if (!keys.ok) return keys;
  const idempotencyKey = parseIdempotencyKey(value.idempotencyKey);
  if (!idempotencyKey.ok) return idempotencyKey;
  const command = parseFlashcardStudyCommand({
    type: 'flashcards/study/claim',
    roundId: value.roundId,
    expectedRevision: value.expectedRevision,
    expectedControlEpoch: value.expectedControlEpoch,
  });
  if (!command.ok) return command;
  if (command.value.type !== 'flashcards/study/claim') {
    return fail('internal claim parse mismatch');
  }
  return ok({
    action: 'claim',
    idempotencyKey: idempotencyKey.value,
    roundId: command.value.roundId,
    expectedRevision: command.value.expectedRevision,
    expectedControlEpoch: command.value.expectedControlEpoch,
  });
}

function parseWriteCheckpoint(
  value: Record<string, unknown>,
): FlashcardStudyParseResult<FlashcardStudyWriteToolInput> {
  const keys = assertAllowedKeys(value, [
    'action',
    'idempotencyKey',
    'roundId',
    'expectedRevision',
    'controlEpoch',
    'entryId',
    'contentVersion',
    'face',
    'needsReview',
  ]);
  if (!keys.ok) return keys;
  const idempotencyKey = parseIdempotencyKey(value.idempotencyKey);
  if (!idempotencyKey.ok) return idempotencyKey;
  const command = parseFlashcardStudyCommand({
    type: 'flashcards/study/checkpoint',
    roundId: value.roundId,
    expectedRevision: value.expectedRevision,
    controlEpoch: value.controlEpoch,
    entryId: value.entryId,
    contentVersion: value.contentVersion,
    face: value.face,
    ...(value.needsReview !== undefined ? { needsReview: value.needsReview } : {}),
  });
  if (!command.ok) return command;
  if (command.value.type !== 'flashcards/study/checkpoint') {
    return fail('internal checkpoint parse mismatch');
  }
  const { type: _t, id: _i, ...rest } = command.value;
  return ok({ action: 'checkpoint', idempotencyKey: idempotencyKey.value, ...rest });
}

function parseWriteRate(
  value: Record<string, unknown>,
): FlashcardStudyParseResult<FlashcardStudyWriteToolInput> {
  const keys = assertAllowedKeys(value, [
    'action',
    'idempotencyKey',
    'roundId',
    'expectedRevision',
    'controlEpoch',
    'entryId',
    'contentVersion',
    'rating',
    'expectedReviewStateRevision',
  ]);
  if (!keys.ok) return keys;
  const idempotencyKey = parseIdempotencyKey(value.idempotencyKey);
  if (!idempotencyKey.ok) return idempotencyKey;
  const command = parseFlashcardStudyCommand({
    type: 'flashcards/study/rate',
    roundId: value.roundId,
    expectedRevision: value.expectedRevision,
    controlEpoch: value.controlEpoch,
    entryId: value.entryId,
    contentVersion: value.contentVersion,
    rating: value.rating,
    expectedReviewStateRevision: value.expectedReviewStateRevision,
  });
  if (!command.ok) return command;
  if (command.value.type !== 'flashcards/study/rate') {
    return fail('internal rate parse mismatch');
  }
  const { type: _t, id: _i, ...rest } = command.value;
  return ok({ action: 'rate', idempotencyKey: idempotencyKey.value, ...rest });
}

function parseWriteUndo(
  value: Record<string, unknown>,
): FlashcardStudyParseResult<FlashcardStudyWriteToolInput> {
  const keys = assertAllowedKeys(value, [
    'action',
    'idempotencyKey',
    'roundId',
    'expectedRevision',
    'controlEpoch',
    'targetOperationId',
  ]);
  if (!keys.ok) return keys;
  const idempotencyKey = parseIdempotencyKey(value.idempotencyKey);
  if (!idempotencyKey.ok) return idempotencyKey;
  const command = parseFlashcardStudyCommand({
    type: 'flashcards/study/undo',
    roundId: value.roundId,
    expectedRevision: value.expectedRevision,
    controlEpoch: value.controlEpoch,
    targetOperationId: value.targetOperationId,
  });
  if (!command.ok) return command;
  if (command.value.type !== 'flashcards/study/undo') {
    return fail('internal undo parse mismatch');
  }
  const { type: _t, id: _i, ...rest } = command.value;
  return ok({ action: 'undo', idempotencyKey: idempotencyKey.value, ...rest });
}

function parseWriteEpoch(
  value: Record<string, unknown>,
  action: 'pause' | 'resume' | 'end',
): FlashcardStudyParseResult<FlashcardStudyWriteToolInput> {
  const keys = assertAllowedKeys(value, [
    'action',
    'idempotencyKey',
    'roundId',
    'expectedRevision',
    'controlEpoch',
  ]);
  if (!keys.ok) return keys;
  const idempotencyKey = parseIdempotencyKey(value.idempotencyKey);
  if (!idempotencyKey.ok) return idempotencyKey;
  const command = parseFlashcardStudyCommand({
    type: `flashcards/study/${action}`,
    roundId: value.roundId,
    expectedRevision: value.expectedRevision,
    controlEpoch: value.controlEpoch,
  });
  if (!command.ok) return command;
  if (
    command.value.type !== 'flashcards/study/pause' &&
    command.value.type !== 'flashcards/study/resume' &&
    command.value.type !== 'flashcards/study/end'
  ) {
    return fail(`internal ${action} parse mismatch`);
  }
  return ok({
    action,
    idempotencyKey: idempotencyKey.value,
    roundId: command.value.roundId,
    expectedRevision: command.value.expectedRevision,
    controlEpoch: command.value.controlEpoch,
  });
}

function parseIdempotencyKey(value: unknown): FlashcardStudyParseResult<string> {
  // Reuse native study id rules via the operation command parser.
  const command = parseFlashcardStudyCommand({
    type: 'flashcards/study/operation',
    idempotencyKey: value,
  });
  if (!command.ok) {
    return fail(
      command.error.startsWith('idempotencyKey')
        ? command.error
        : `idempotencyKey is not a valid study id`,
    );
  }
  if (command.value.type !== 'flashcards/study/operation') {
    return fail('idempotencyKey is not a valid study id');
  }
  return ok(command.value.idempotencyKey);
}

/**
 * Scheduled MVP scopes: all | deck only, unknown nested fields rejected,
 * deck must have no leading/trailing whitespace (CardStore matches exactly).
 */
function parseScheduledMvpScope(
  value: unknown,
  field: string,
): FlashcardStudyParseResult<FlashcardStudyScheduledStartScope> {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return fail(`${field} must be a discriminated object`);
  }
  if (!SCHEDULED_MVP_SCOPE_KINDS.has(value.kind)) {
    return fail(`${field} must be all or deck`);
  }
  const allowed = SCOPE_KEYS_BY_KIND[value.kind as FlashcardStudyScope['kind']];
  const keys = assertAllowedKeys(value, allowed);
  if (!keys.ok) return keys;

  if (value.kind === 'deck') {
    if (typeof value.deck !== 'string') {
      return fail('deck must be a non-empty string');
    }
    // Reject padded decks rather than silently trim: CardStore uses exact match
    // and does not canonicalize deck names.
    if (value.deck !== value.deck.trim()) {
      return fail('deck must not have leading or trailing whitespace');
    }
  }

  const parsed = parseFlashcardStudyScope(value);
  if (!parsed.ok) return parsed;
  if (parsed.value.kind !== 'all' && parsed.value.kind !== 'deck') {
    return fail(`${field} must be all or deck`);
  }
  return ok(parsed.value);
}

function rejectForbiddenAuthority(
  value: Record<string, unknown>,
): FlashcardStudyParseResult<void> {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_AUTHORITY_SET.has(key)) {
      return fail(`forbidden authority field ${key}`);
    }
  }
  return ok(undefined);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): FlashcardStudyParseResult<void> {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_AUTHORITY_SET.has(key)) {
      return fail(`forbidden authority field ${key}`);
    }
    if (!allowedSet.has(key)) {
      return fail(`unknown field ${key}`);
    }
  }
  return ok(undefined);
}

function requirePlainObject(
  value: unknown,
): FlashcardStudyParseResult<Record<string, unknown>> {
  if (!isRecord(value)) {
    return fail('tool input must be a plain object');
  }
  return ok(value);
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
