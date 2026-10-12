/**
 * Model-facing flashcard study tool contracts (scheduled MVP).
 *
 * Host tools `flashcard_study_read` / `flashcard_study_write` admit study
 * actions through the normal tool gate. Control identity is Host-bound from
 * the product session — never accepted from model arguments.
 *
 * Parsers: `flashcard-study-tool-input.ts`. Schemas: `flashcard-study-tool-schemas.ts`.
 */
import {
  type FlashcardStudyCatalogCommand,
  type FlashcardStudyClaimCommand,
  type FlashcardStudyCheckpointCommand,
  type FlashcardStudyEndCommand,
  type FlashcardStudyGetCommand,
  type FlashcardStudyOperationCommand,
  type FlashcardStudyParseResult,
  type FlashcardStudyPauseCommand,
  type FlashcardStudyRateCommand,
  type FlashcardStudyResumeCommand,
  type FlashcardStudyStartCommand,
  type FlashcardStudyUndoCommand,
  isPathLikeFlashcardStudyId,
} from './flashcard-study-commands.js';
import {
  parseFlashcardStudyReadToolInputImpl,
  parseFlashcardStudyWriteToolInputImpl,
} from './flashcard-study-tool-input.js';

export const FLASHCARD_STUDY_READ_TOOL_NAME = 'flashcard_study_read' as const;
export const FLASHCARD_STUDY_WRITE_TOOL_NAME = 'flashcard_study_write' as const;

export const FLASHCARD_STUDY_READ_PERMISSION_ACTION = 'flashcards:study-read' as const;
export const FLASHCARD_STUDY_WRITE_PERMISSION_ACTION = 'flashcards:study-write' as const;

/** Existing session tool families — no new enum values. */
export const FLASHCARD_STUDY_READ_TOOL_FAMILY = 'flashcards-read' as const;
export const FLASHCARD_STUDY_WRITE_TOOL_FAMILY = 'flashcards-write' as const;

export const FLASHCARD_STUDY_READ_ACTIONS = ['catalog', 'get', 'operation'] as const;
export type FlashcardStudyReadAction = (typeof FLASHCARD_STUDY_READ_ACTIONS)[number];

export const FLASHCARD_STUDY_WRITE_ACTIONS = [
  'start',
  'claim',
  'checkpoint',
  'rate',
  'undo',
  'pause',
  'resume',
  'end',
] as const;
export type FlashcardStudyWriteAction = (typeof FLASHCARD_STUDY_WRITE_ACTIONS)[number];

/** Keys the model must never supply; Host binds these from admitted context. */
export const FLASHCARD_STUDY_TOOL_FORBIDDEN_AUTHORITY_KEYS = [
  'type',
  'controllerIdentity',
  'principal',
  'sessionId',
  'runId',
  'runtimeGenerationId',
  'toolCallId',
  'toolName',
] as const;

export type FlashcardStudyScheduledStartScope =
  | { kind: 'all' }
  | { kind: 'deck'; deck: string };

export type FlashcardStudyReadToolInput =
  | ({ action: 'catalog' } & Omit<FlashcardStudyCatalogCommand, 'type' | 'id'>)
  | ({ action: 'get' } & Omit<FlashcardStudyGetCommand, 'type' | 'id'>)
  | ({ action: 'operation' } & Omit<FlashcardStudyOperationCommand, 'type' | 'id'>);

type WriteBase = { idempotencyKey: string };

export type FlashcardStudyWriteToolInput =
  | (WriteBase & {
      action: 'start';
      mode: 'scheduled';
      scope: FlashcardStudyScheduledStartScope;
      resumeExisting: boolean;
    })
  | (WriteBase & { action: 'claim' } & Omit<FlashcardStudyClaimCommand, 'type' | 'id'>)
  | (WriteBase & { action: 'checkpoint' } & Omit<FlashcardStudyCheckpointCommand, 'type' | 'id'>)
  | (WriteBase & { action: 'rate' } & Omit<FlashcardStudyRateCommand, 'type' | 'id'>)
  | (WriteBase & { action: 'undo' } & Omit<FlashcardStudyUndoCommand, 'type' | 'id'>)
  | (WriteBase & { action: 'pause' } & Omit<FlashcardStudyPauseCommand, 'type' | 'id'>)
  | (WriteBase & { action: 'resume' } & Omit<FlashcardStudyResumeCommand, 'type' | 'id'>)
  | (WriteBase & { action: 'end' } & Omit<FlashcardStudyEndCommand, 'type' | 'id'>);

// Re-export schemas so callers can import tools + schemas from one module.
export {
  FLASHCARD_STUDY_READ_TOOL_PARAMETERS,
  FLASHCARD_STUDY_WRITE_TOOL_PARAMETERS,
} from './flashcard-study-tool-schemas.js';

/**
 * Stable controller principal for agent-driven study rounds.
 * Host derives this from the admitted product sessionId — never from model args.
 */
export function flashcardStudyAgentControllerPrincipal(
  sessionId: string,
): FlashcardStudyParseResult<string> {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return { ok: false, error: 'sessionId must be a non-empty string' };
  }
  if (isPathLikeFlashcardStudyId(sessionId) || sessionId.includes(':')) {
    return { ok: false, error: 'sessionId is not a valid study controller base' };
  }
  return { ok: true, value: `agent:${sessionId}` };
}

export function parseFlashcardStudyReadToolInput(
  value: unknown,
): FlashcardStudyParseResult<FlashcardStudyReadToolInput> {
  return parseFlashcardStudyReadToolInputImpl(value);
}

export function parseFlashcardStudyWriteToolInput(
  value: unknown,
): FlashcardStudyParseResult<FlashcardStudyWriteToolInput> {
  return parseFlashcardStudyWriteToolInputImpl(value);
}

/** Map a parsed write tool input onto the native Host study command shape. */
export function flashcardStudyWriteInputToCommand(
  input: FlashcardStudyWriteToolInput,
):
  | FlashcardStudyStartCommand
  | FlashcardStudyClaimCommand
  | FlashcardStudyCheckpointCommand
  | FlashcardStudyRateCommand
  | FlashcardStudyUndoCommand
  | FlashcardStudyPauseCommand
  | FlashcardStudyResumeCommand
  | FlashcardStudyEndCommand {
  const id = input.idempotencyKey;
  switch (input.action) {
    case 'start':
      return {
        id,
        type: 'flashcards/study/start',
        mode: input.mode,
        scope: input.scope,
        resumeExisting: input.resumeExisting,
      };
    case 'claim':
      return {
        id,
        type: 'flashcards/study/claim',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        expectedControlEpoch: input.expectedControlEpoch,
      };
    case 'checkpoint':
      return {
        id,
        type: 'flashcards/study/checkpoint',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
        entryId: input.entryId,
        contentVersion: input.contentVersion,
        face: input.face,
        ...(input.needsReview !== undefined ? { needsReview: input.needsReview } : {}),
      };
    case 'rate':
      return {
        id,
        type: 'flashcards/study/rate',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
        entryId: input.entryId,
        contentVersion: input.contentVersion,
        rating: input.rating,
        expectedReviewStateRevision: input.expectedReviewStateRevision,
      };
    case 'undo':
      return {
        id,
        type: 'flashcards/study/undo',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
        targetOperationId: input.targetOperationId,
      };
    case 'pause':
      return {
        id,
        type: 'flashcards/study/pause',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
      };
    case 'resume':
      return {
        id,
        type: 'flashcards/study/resume',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
      };
    case 'end':
      return {
        id,
        type: 'flashcards/study/end',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
      };
  }
}

/** Map a parsed read tool input onto the native Host study command shape. */
export function flashcardStudyReadInputToCommand(
  input: FlashcardStudyReadToolInput,
): FlashcardStudyCatalogCommand | FlashcardStudyGetCommand | FlashcardStudyOperationCommand {
  switch (input.action) {
    case 'catalog':
      return {
        type: 'flashcards/study/catalog',
        limit: input.limit,
        ...(input.scopeFilter ? { scopeFilter: input.scopeFilter } : {}),
        ...(input.query !== undefined ? { query: input.query } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}),
      };
    case 'get':
      return { type: 'flashcards/study/get', roundId: input.roundId };
    case 'operation':
      return { type: 'flashcards/study/operation', idempotencyKey: input.idempotencyKey };
  }
}
