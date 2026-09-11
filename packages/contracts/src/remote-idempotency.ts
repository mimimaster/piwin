import type { HostCommand } from './ipc.js';

/** Remote mutations that must carry a caller-owned idempotency key. */
export const REMOTE_IDEMPOTENT_MUTATION_TYPES = [
  'session/prompt',
  'session/queued-turn-submit',
  'session/replace-run',
  'session/abort',
  'session/delete',
  'session/create',
  'permission/resolve',
  'settings/apply',
  'auth/login',
  'pi-environment/apply',
  'notes/write',
  'notes/update',
  'notes/delete',
  'todo/set',
  'subagent/request-resolution',
  'turn-changes/undo',
  'turn-changes/redo',
  'turn-changes/cancel',
  'turn-changes/recovery-run',
  'flashcards/study/start',
  'flashcards/study/claim',
  'flashcards/study/checkpoint',
  'flashcards/study/next',
  'flashcards/study/goto',
  'flashcards/study/rate',
  'flashcards/study/undo',
  'flashcards/study/pause',
  'flashcards/study/resume',
  'flashcards/study/end',
] as const satisfies readonly HostCommand['type'][];

export function remoteCommandRequiresIdempotencyKey(type: HostCommand['type']): boolean {
  return (REMOTE_IDEMPOTENT_MUTATION_TYPES as readonly HostCommand['type'][]).includes(type);
}
