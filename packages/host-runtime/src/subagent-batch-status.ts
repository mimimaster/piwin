import type { SubagentTaskResult } from '@piwin/contracts';

export type PersistedSubagentBatchStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'needs-integration';

/** Reconcile a settled batch after the user handles one retained worktree. */
export function reconcileSubagentBatchStatusAfterWorktreeAction(
  currentStatus: PersistedSubagentBatchStatus,
  results: readonly SubagentTaskResult[],
): PersistedSubagentBatchStatus {
  if (currentStatus !== 'needs-integration') return currentStatus;

  if (
    results.some(
      (result) =>
        result.integrationStatus === 'retained' || result.integrationStatus === 'conflict',
    )
  ) {
    return 'needs-integration';
  }
  if (
    results.some(
      (result) =>
        result.executionStatus === 'failed' || result.integrationStatus === 'failed',
    )
  ) {
    return 'failed';
  }
  if (results.some((result) => result.executionStatus === 'cancelled')) {
    return 'cancelled';
  }
  return 'completed';
}
