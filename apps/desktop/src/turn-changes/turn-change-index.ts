/**
 * Client-side index of Host turn-change summaries: by change set, and which
 * change set each run belongs to. Fed by `turn-changes/list-by-runs` replies
 * and `turn-changes/updated` pushes; a turn looks itself up by its runIds.
 */
import type { TurnChangeSummary } from '@piwin/contracts';

export type TurnChangeIndex = {
  readonly summaries: ReadonlyMap<string, TurnChangeSummary>;
  readonly runToChangeSet: ReadonlyMap<string, string>;
};

export const EMPTY_TURN_CHANGE_INDEX: TurnChangeIndex = {
  summaries: new Map(),
  runToChangeSet: new Map(),
};

/** A reply or push is stale when it is for an older revision of the same change set. */
function isStale(current: TurnChangeSummary | undefined, incoming: TurnChangeSummary): boolean {
  return current !== undefined && incoming.revision < current.revision;
}

export function applyTurnChangeSummaries(
  index: TurnChangeIndex,
  incoming: readonly TurnChangeSummary[],
): TurnChangeIndex {
  let summaries: Map<string, TurnChangeSummary> | null = null;
  let runs: Map<string, string> | null = null;
  for (const summary of incoming) {
    if (isStale((summaries ?? index.summaries).get(summary.changeSetId), summary)) {
      continue;
    }
    summaries ??= new Map(index.summaries);
    summaries.set(summary.changeSetId, summary);
    for (const runId of summary.runIds) {
      if ((runs ?? index.runToChangeSet).get(runId) === summary.changeSetId) continue;
      runs ??= new Map(index.runToChangeSet);
      runs.set(runId, summary.changeSetId);
    }
  }
  if (!summaries && !runs) return index;
  return {
    summaries: summaries ?? index.summaries,
    runToChangeSet: runs ?? index.runToChangeSet,
  };
}

/**
 * Change sets for one turn, oldest first. Usually one; a turn resumed after
 * its changes were undone has a second (product decision 2026-09-29).
 */
export function selectTurnChangeSummaries(
  index: TurnChangeIndex,
  runIds: readonly string[],
): TurnChangeSummary[] {
  const seen = new Set<string>();
  const result: TurnChangeSummary[] = [];
  for (const runId of runIds) {
    const changeSetId = index.runToChangeSet.get(runId);
    if (!changeSetId || seen.has(changeSetId)) continue;
    seen.add(changeSetId);
    const summary = index.summaries.get(changeSetId);
    if (summary) result.push(summary);
  }
  return result;
}

/** Runs a turn passes as one stable string, so rows do not re-render on array identity. */
export function encodeTurnRunIds(runIds: readonly (string | undefined)[]): string {
  return [...new Set(runIds.filter((runId): runId is string => Boolean(runId)))].join('\n');
}

export function decodeTurnRunIds(encoded: string | undefined): string[] {
  return encoded ? encoded.split('\n').filter(Boolean) : [];
}
