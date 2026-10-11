import type { SessionBackendBinding } from '@piwin/contracts';

/**
 * Whether the agent holds history the transcript projection has not replayed
 * (ADR 0082): the projection was never synced from the agent (a session
 * imported from its catalog, or a lost projection), or the agent changed the
 * session since, e.g. the user continued in its own TUI. Sessions created in
 * piwin record `syncedChangeUnixMs` on first bind, so they are never stale
 * until the agent reports a newer change. A binding without a native id has
 * nothing to replay.
 */
export function externalProjectionNeedsReplay(
  binding: SessionBackendBinding,
  catalogChangeUnixMs: number | undefined,
): boolean {
  if (binding.backendSessionId === undefined) return false;
  return binding.syncedChangeUnixMs === undefined || binding.syncedChangeUnixMs < (catalogChangeUnixMs ?? 0);
}
