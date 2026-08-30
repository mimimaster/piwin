/**
 * Host IPC for flashcards/study/*. Composes the domain StudyService with
 * authenticated connection identity. Do not add these handlers to knowledge-commands.
 */
import {
  FLASHCARD_STUDY_MUTATION_TYPES,
  PiwinError,
  formatError,
  isFlashcardStudyCommandType,
  isPathLikeFlashcardStudyId,
  parseFlashcardStudyCommand,
  type FlashcardStudyCatalogPage,
  type FlashcardStudyChangedReason,
  type FlashcardStudyHostCommand,
  type FlashcardStudyMutationType,
  type FlashcardStudyOperationResult,
  type FlashcardStudySnapshot,
  type HostCommand,
  type HostPush,
  type HostResponse,
} from '@piwin/contracts';
import type { StudyService } from '@piwin/flashcards';
import { fail, ok } from '../response-helpers.js';

export type FlashcardStudyCommandContext = {
  getStudyService: () => Promise<StudyService>;
  controllerIdentity: string;
  idempotencyKey?: string;
};

const MUTATION_TYPES = new Set<string>(FLASHCARD_STUDY_MUTATION_TYPES);

export function isFlashcardStudyCommand(command: HostCommand): boolean {
  return isFlashcardStudyCommandType(command.type);
}

/** Global study push is summary-only — never attach question/answer/source bodies. */
export function toStudyChangedPush(event: {
  roundId: string;
  revision: number;
  reason: FlashcardStudyChangedReason;
}): HostPush {
  return {
    type: 'flashcards/study/changed',
    roundId: event.roundId,
    revision: event.revision,
    reason: event.reason,
  };
}

export async function handleFlashcardStudyCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: FlashcardStudyCommandContext | undefined,
): Promise<HostResponse | null> {
  if (!isFlashcardStudyCommand(command)) return null;
  if (!context) {
    return fail(requestId, command.type, 'flashcard study services are not available in this host mode');
  }
  const parsed = parseFlashcardStudyCommand(command);
  if (!parsed.ok) {
    return fail(requestId, command.type, parsed.error, { code: 'invalid-command' });
  }
  try {
    const study = await context.getStudyService();
    return await dispatchStudy(parsed.value, requestId, context, study);
  } catch (error) {
    return mapStudyError(requestId, command.type, error);
  }
}

async function dispatchStudy(
  command: FlashcardStudyHostCommand,
  requestId: string | undefined,
  context: FlashcardStudyCommandContext,
  study: StudyService,
): Promise<HostResponse> {
  const identity = context.controllerIdentity;
  switch (command.type) {
    case 'flashcards/study/catalog': {
      const page = await study.catalog({
        ...(command.scopeFilter ? { scopeFilter: command.scopeFilter } : {}),
        ...(command.query ? { query: command.query } : {}),
        ...(command.cursor ? { cursor: command.cursor } : {}),
        limit: command.limit,
      });
      return ok(requestId, command.type, sanitizeCatalogPage(page));
    }
    case 'flashcards/study/get': {
      const snapshot = await study.get(command.roundId, identity);
      return ok(requestId, command.type, sanitizeSnapshot(snapshot));
    }
    case 'flashcards/study/operation': {
      const result = await study.operation(command.idempotencyKey, identity);
      return ok(requestId, command.type, sanitizeOperationResult(result));
    }
    default:
      return mutate(command, requestId, context, study, identity);
  }
}

async function mutate(
  command: Extract<FlashcardStudyHostCommand, { type: FlashcardStudyMutationType }>,
  requestId: string | undefined,
  context: FlashcardStudyCommandContext,
  study: StudyService,
  identity: string,
): Promise<HostResponse> {
  const idempotencyKey = requireIdempotencyKey(
    requestId,
    command.type,
    context.idempotencyKey,
  );
  if (typeof idempotencyKey !== 'string') return idempotencyKey;
  const snapshot = await runMutation(command, study, identity, idempotencyKey);
  return ok(requestId, command.type, sanitizeSnapshot(snapshot));
}

function runMutation(
  command: Extract<FlashcardStudyHostCommand, { type: FlashcardStudyMutationType }>,
  study: StudyService,
  identity: string,
  idempotencyKey: string,
): Promise<FlashcardStudySnapshot> {
  const base = {
    idempotencyKey,
    controllerIdentity: identity,
  };
  switch (command.type) {
    case 'flashcards/study/start':
      return study.start({
        ...base,
        mode: command.mode,
        scope: command.scope,
        resumeExisting: command.resumeExisting,
      });
    case 'flashcards/study/claim':
      return study.claim({
        ...base,
        roundId: command.roundId,
        expectedRevision: command.expectedRevision,
        controlEpoch: command.expectedControlEpoch,
      });
    case 'flashcards/study/checkpoint':
      return study.checkpoint({
        ...base,
        roundId: command.roundId,
        expectedRevision: command.expectedRevision,
        controlEpoch: command.controlEpoch,
        entryId: command.entryId,
        contentVersion: command.contentVersion,
        face: command.face,
        ...(command.needsReview !== undefined ? { needsReview: command.needsReview } : {}),
      });
    case 'flashcards/study/next':
      return study.next({
        ...base,
        roundId: command.roundId,
        expectedRevision: command.expectedRevision,
        controlEpoch: command.controlEpoch,
        entryId: command.entryId,
        contentVersion: command.contentVersion,
      });
    case 'flashcards/study/rate':
      return study.rate({
        ...base,
        roundId: command.roundId,
        expectedRevision: command.expectedRevision,
        controlEpoch: command.controlEpoch,
        entryId: command.entryId,
        contentVersion: command.contentVersion,
        rating: command.rating,
        expectedReviewStateRevision: command.expectedReviewStateRevision,
      });
    case 'flashcards/study/undo':
      return study.undo({
        ...base,
        roundId: command.roundId,
        expectedRevision: command.expectedRevision,
        controlEpoch: command.controlEpoch,
        targetOperationId: command.targetOperationId,
      });
    case 'flashcards/study/pause':
      return study.pause({
        ...base,
        roundId: command.roundId,
        expectedRevision: command.expectedRevision,
        controlEpoch: command.controlEpoch,
      });
    case 'flashcards/study/resume':
      return study.resume({
        ...base,
        roundId: command.roundId,
        expectedRevision: command.expectedRevision,
        controlEpoch: command.controlEpoch,
      });
    case 'flashcards/study/end':
      return study.end({
        ...base,
        roundId: command.roundId,
        expectedRevision: command.expectedRevision,
        controlEpoch: command.controlEpoch,
      });
  }
}

function requireIdempotencyKey(
  requestId: string | undefined,
  type: FlashcardStudyMutationType,
  key: string | undefined,
): string | HostResponse {
  const trimmed = key?.trim() ?? '';
  if (MUTATION_TYPES.has(type) && trimmed.length === 0) {
    return fail(requestId, type, 'idempotency-key-required', { code: 'idempotency-key-required' });
  }
  return trimmed;
}

function mapStudyError(requestId: string | undefined, command: string, error: unknown): HostResponse {
  if (error instanceof PiwinError) {
    return fail(requestId, command, error.message, {
      code: error.code,
      retryable: error.retryable,
    });
  }
  return fail(requestId, command, formatError(error));
}

export function sanitizeCatalogPage(page: FlashcardStudyCatalogPage): FlashcardStudyCatalogPage {
  const serialized = JSON.stringify(page);
  if (!serializedIncludesHostPath(serialized) && !serialized.includes('"back"')) {
    return page;
  }
  return JSON.parse(
    JSON.stringify(page, (key, value) => {
      if (key === 'back' || key === 'sourceFile' || key === 'sourceFolder' || key === 'path') {
        return undefined;
      }
      if (typeof value === 'string' && isHostAbsolutePath(value) && key !== 'preview') {
        return undefined;
      }
      return value;
    }),
  ) as FlashcardStudyCatalogPage;
}

export function sanitizeSnapshot(snapshot: FlashcardStudySnapshot): FlashcardStudySnapshot {
  const current = snapshot.current;
  if (!current) return snapshot;
  const next = { ...current };
  if (next.sourceTitle) next.sourceTitle = safeSourceTitle(next.sourceTitle);
  return { ...snapshot, current: next };
}

export function sanitizeOperationResult(
  result: FlashcardStudyOperationResult,
): FlashcardStudyOperationResult {
  if (result.status !== 'success') return result;
  return { status: 'success', snapshot: sanitizeSnapshot(result.snapshot) };
}

function safeSourceTitle(value: string): string {
  if (!isHostAbsolutePath(value)) return value;
  const parts = value.split(/[/\\]/);
  return parts[parts.length - 1] ?? value;
}

function serializedIncludesHostPath(serialized: string): boolean {
  return serialized.includes('"sourceFile"') || serialized.includes('"sourceFolder"');
}

function isHostAbsolutePath(value: string): boolean {
  return isPathLikeFlashcardStudyId(value) || value.startsWith('/');
}
