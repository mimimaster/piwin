/**
 * Pick which of a child's results an action addresses.
 *
 * A persistent sidekick lane reuses one child across many runs, so "the
 * child's result" is ambiguous. Without a target the action means the newest
 * result (what the Desktop shows); with a target it means exactly that run and
 * task, which is the only way an older undecided result can ever be settled.
 */
export function selectChildResult<T extends { manifest: { runId: string }; task: { id: string } }>(
  /** Newest first. */
  entries: readonly T[],
  target?: { runId: string; taskId: string },
): { entry: T | undefined; isLatest: boolean } {
  const latest = entries[0];
  const entry = target
    ? entries.find(
        (candidate) =>
          candidate.manifest.runId === target.runId && candidate.task.id === target.taskId,
      )
    : latest;
  return { entry, isLatest: entry !== undefined && entry === latest };
}
