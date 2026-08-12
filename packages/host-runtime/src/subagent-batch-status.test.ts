import { describe, expect, it } from 'vitest';
import type { SubagentTaskResult } from '@piwin/contracts';
import { reconcileSubagentBatchStatusAfterWorktreeAction } from './subagent-batch-status.js';

function result(
  overrides: Partial<SubagentTaskResult> = {},
): SubagentTaskResult {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'applied',
    ...overrides,
  };
}

describe('reconcileSubagentBatchStatusAfterWorktreeAction', () => {
  it('completes a pending batch after its last retained worktree is handled', () => {
    expect(
      reconcileSubagentBatchStatusAfterWorktreeAction('needs-integration', [result()]),
    ).toBe('completed');
  });

  it('stays pending while another task remains retained or conflicted', () => {
    expect(
      reconcileSubagentBatchStatusAfterWorktreeAction('needs-integration', [
        result(),
        result({ taskId: 'task-2', integrationStatus: 'retained' }),
      ]),
    ).toBe('needs-integration');
  });

  it('preserves terminal failure semantics after integration is resolved', () => {
    expect(
      reconcileSubagentBatchStatusAfterWorktreeAction('needs-integration', [
        result({ executionStatus: 'failed' }),
      ]),
    ).toBe('failed');
  });

  it('does not rewrite batches that were not waiting for integration', () => {
    expect(
      reconcileSubagentBatchStatusAfterWorktreeAction('cancelled', [result()]),
    ).toBe('cancelled');
  });
});
