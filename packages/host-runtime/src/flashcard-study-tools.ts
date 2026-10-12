import { createHash } from 'node:crypto';
import {
  FLASHCARD_STUDY_READ_TOOL_NAME, FLASHCARD_STUDY_WRITE_TOOL_NAME,
  FLASHCARD_STUDY_READ_TOOL_PARAMETERS, FLASHCARD_STUDY_WRITE_TOOL_PARAMETERS,
  flashcardStudyAgentControllerPrincipal, flashcardStudyWriteInputToCommand,
  parseFlashcardStudyReadToolInput, parseFlashcardStudyWriteToolInput,
  PiwinError, StudyControlLostError, formatError,
  type FlashcardStudySnapshot, type HostToolRegistration, type ToolResult,
} from '@piwin/contracts';
import type { StudyService } from '@piwin/flashcards';
import {
  runFlashcardStudyMutation, sanitizeCatalogPage, sanitizeSnapshot,
} from './commands/flashcard-study-commands.js';

export type BuildFlashcardStudyToolsOptions = {
  getStudyService: () => Promise<StudyService>;
};

function reject(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}
function aborted(idempotencyKey?: string): ToolResult {
  return { ok: false, code: 'aborted', cancelled: true,
    message: idempotencyKey ? 'Study write aborted; outcome may be committed. Query operation with the original key.' : 'Study read aborted.',
    ...(idempotencyKey ? { details: { idempotencyKey } } : {}) };
}
function success(value: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(value, null, 2) };
}
function failure(error: unknown): ToolResult {
  return { ok: false, code: 'execution-failed', message: formatError(error),
    ...(error instanceof PiwinError ? { details: { reason: error.code, retryable: error.retryable } } : {}) };
}
function projected(snapshot: FlashcardStudySnapshot): Omit<FlashcardStudySnapshot, 'nextShell' | 'roster'> {
  if (snapshot.round.mode !== 'scheduled') throw new PiwinError('invalid-input', 'Study tools support scheduled rounds only.');
  const { nextShell: _next, roster: _roster, ...currentOnly } = sanitizeSnapshot(snapshot);
  return currentOnly;
}
/** Session-bound namespace prevents a caller's key from replaying another principal's mutation. */
function operationKey(principal: string, key: string): string {
  return `study-tool-${createHash('sha256').update(JSON.stringify([principal, key])).digest('hex')}`;
}

export function buildFlashcardStudyTools(options: BuildFlashcardStudyToolsOptions): HostToolRegistration[] {
  const read: HostToolRegistration = {
    descriptor: {
      name: FLASHCARD_STUDY_READ_TOOL_NAME,
      description: 'Read native scheduled study catalog, current round, or the outcome of your original write idempotencyKey. No next answer/roster. Discover write schema for CAS fields; do not invent identities.',
      parameters: FLASHCARD_STUDY_READ_TOOL_PARAMETERS,
    },
    family: 'flashcards-read',
    permissionSpec: { action: 'flashcards:study-read', risk: 'unknown', rememberable: false, readOnly: true },
    prepareArgs(args, _context, signal) {
      if (signal.aborted) return { ok: false, result: aborted() };
      const parsed = parseFlashcardStudyReadToolInput(args);
      return parsed.ok ? { ok: true, arguments: { ...parsed.value } } : { ok: false, result: reject(parsed.error) };
    },
    async execute(args, signal, context) {
      if (signal.aborted) return aborted();
      const parsed = parseFlashcardStudyReadToolInput(args);
      if (!parsed.ok) return reject(parsed.error);
      const principal = flashcardStudyAgentControllerPrincipal(context.sessionId);
      if (!principal.ok) return reject(principal.error);
      try {
        const study = await options.getStudyService();
        if (signal.aborted) return aborted();
        const input = parsed.value;
        let result: unknown;
        switch (input.action) {
          case 'catalog': {
            const { action: _action, ...filter } = input;
            const page = sanitizeCatalogPage(await study.catalog(filter));
            result = { ...page, unfinishedRounds: page.unfinishedRounds.filter(round => round.mode === 'scheduled') };
            break;
          }
          case 'get': result = projected(await study.get(input.roundId, principal.value)); break;
          case 'operation': {
            const operation = await study.operation(operationKey(principal.value, input.idempotencyKey), principal.value);
            result = operation.status === 'success' ? { status: 'success', snapshot: projected(operation.snapshot) } : operation;
            break;
          }
        }
        return signal.aborted ? aborted() : success(result);
      } catch (error) { return signal.aborted ? aborted() : failure(error); }
    },
  };
  const write: HostToolRegistration = {
    descriptor: {
      name: FLASHCARD_STUDY_WRITE_TOOL_NAME,
      description: 'Mutate native scheduled study with explicit stable idempotencyKey and snapshot CAS fields: start/claim/checkpoint/rate/undo/pause/resume/end. Never auto-claim. Rate only after user approval. On unknown outcome query operation with the original key; reuse that key/payload, not a new one. No sequence/next/goto.',
      parameters: FLASHCARD_STUDY_WRITE_TOOL_PARAMETERS,
    },
    family: 'flashcards-write',
    permissionSpec: { action: 'flashcards:study-write', risk: 'unknown', rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'flashcards:study-write' }) },
    prepareArgs(args, _context, signal) {
      if (signal.aborted) return { ok: false, result: aborted() };
      const parsed = parseFlashcardStudyWriteToolInput(args);
      return parsed.ok ? { ok: true, arguments: { ...parsed.value } } : { ok: false, result: reject(parsed.error) };
    },
    async execute(args, signal, context) {
      if (signal.aborted) return aborted();
      const parsed = parseFlashcardStudyWriteToolInput(args);
      if (!parsed.ok) return reject(parsed.error);
      const principal = flashcardStudyAgentControllerPrincipal(context.sessionId);
      if (!principal.ok) return reject(principal.error);
      const input = parsed.value;
      try {
        const study = await options.getStudyService();
        if (signal.aborted) return aborted(input.idempotencyKey);
        const command = flashcardStudyWriteInputToCommand(input);
        if (command.type !== 'flashcards/study/start') {
          // Mode is immutable. Reject before mutation, but let the native service
          // decide revision/idempotency so stale identical retries still replay.
          const snapshot = await study.get(command.roundId, principal.value);
          if (signal.aborted) return aborted(input.idempotencyKey);
          if (snapshot.round.mode !== 'scheduled') return reject('Study tools support scheduled rounds only.');
          if (command.type !== 'flashcards/study/claim' && !snapshot.access.hasControl) {
            // An epoch is not an identity: callers can read the current epoch.
            // Permit only an already-owned replay; the native path checks its fingerprint.
            const prior = await study.operation(operationKey(principal.value, input.idempotencyKey), principal.value);
            if (signal.aborted) return aborted(input.idempotencyKey);
            if (prior.status !== 'success') throw new StudyControlLostError(command.roundId);
          }
        }
        const snapshot = await runFlashcardStudyMutation(command, study, principal.value, operationKey(principal.value, input.idempotencyKey));
        return signal.aborted ? aborted(input.idempotencyKey) : success(projected(snapshot));
      } catch (error) { return signal.aborted ? aborted(input.idempotencyKey) : failure(error); }
    },
  };
  return [read, write];
}
