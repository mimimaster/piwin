/**
 * Enrich an undo/redo refusal with who changed each blocked path, and emit
 * throttled per-file progress while an operation writes.
 */
import type { HostPush, TurnChangeAvailability, TurnChangePathConflict } from '@piwin/contracts';

import type { TurnChangeRuntime } from './runtime-wiring.js';

/** Minimum spacing between progress pushes; the last file always pushes. */
export const PROGRESS_PUSH_INTERVAL_MS = 100;

/**
 * For a `files-changed` refusal, the later turns (same workspace, sealed
 * after this one) that changed each blocked path. An empty list means the
 * source is unknown and must be shown as such.
 */
export function describePathConflicts(
  runtime: TurnChangeRuntime,
  changeSetId: string,
  affectedPaths: readonly string[],
): TurnChangePathConflict[] {
  const byPath = runtime.store.findLaterTurnsByPath({ changeSetId, relativePaths: affectedPaths });
  return affectedPaths.map((relativePath) => ({
    relativePath,
    laterTurns: byPath.get(relativePath) ?? [],
  }));
}

/** Adds `conflicts` to a files-changed availability; other shapes pass through. */
export function withPathConflicts(
  runtime: TurnChangeRuntime,
  changeSetId: string,
  availability: TurnChangeAvailability,
): TurnChangeAvailability {
  if (availability.allowed || availability.reason !== 'files-changed' || !availability.affectedPaths) {
    return availability;
  }
  return {
    ...availability,
    conflicts: describePathConflicts(runtime, changeSetId, availability.affectedPaths),
  };
}

export function createProgressPusher(input: {
  push: ((message: HostPush) => void) | undefined;
  workspaceId: string;
  changeSetId: string;
  now?: () => number;
}): (operationId: string, done: number, total: number) => void {
  const now = input.now ?? Date.now;
  let lastAt = Number.NEGATIVE_INFINITY;
  return (operationId, done, total) => {
    if (!input.push) return;
    const at = now();
    if (done < total && at - lastAt < PROGRESS_PUSH_INTERVAL_MS) return;
    lastAt = at;
    input.push({
      type: 'turn-changes/operation-updated',
      workspaceId: input.workspaceId,
      operationId,
      changeSetId: input.changeSetId,
      progress: { done, total },
    });
  };
}
