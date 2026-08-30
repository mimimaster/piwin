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
  'notes/write',
  'notes/update',
  'notes/delete',
  'todo/set',
  'subagent/request-resolution',
] as const satisfies readonly HostCommand['type'][];

export function remoteCommandRequiresIdempotencyKey(type: HostCommand['type']): boolean {
  return (REMOTE_IDEMPOTENT_MUTATION_TYPES as readonly HostCommand['type'][]).includes(type);
}
