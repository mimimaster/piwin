import { describe, expect, it, vi } from 'vitest';
import type { SubagentTaskResult } from '@piwin/contracts';
import {
  cleanupAppliedWorktreeCopy,
  decideAppliedCopyCleanup,
  settleAppliedWorktreeCopy,
} from './subagent-copy-cleanup.js';

const RESULT_REF = { resultId: 'res-1', revision: 1 } as const;

function createAppliedResult(): SubagentTaskResult {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    executionStatus: 'completed',
    summaryStatus: 'not-requested',
    integrationStatus: 'pending',
    resultRef: RESULT_REF,
  };
}

describe('decideAppliedCopyCleanup', () => {
  it('removes only after a freeze marker lands and retain is not requested', () => {
    expect(decideAppliedCopyCleanup({ resultRef: RESULT_REF })).toEqual({ action: 'remove' });
  });

  it('keeps pre-upgrade copies when resultRef is missing', () => {
    expect(decideAppliedCopyCleanup({})).toEqual({ action: 'keep', copyState: 'present' });
  });

  it('keeps the copy when retainWorktree is true even with a freeze marker', () => {
    expect(
      decideAppliedCopyCleanup({ resultRef: RESULT_REF, retainWorktree: true }),
    ).toEqual({ action: 'keep', copyState: 'present' });
  });
});

describe('cleanupAppliedWorktreeCopy', () => {
  it('calls remove once for a frozen applied copy', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const outcome = await cleanupAppliedWorktreeCopy({
      resultRef: RESULT_REF,
      remove,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ copyState: 'removed' });
  });

  it('does not call remove when resultRef is missing', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const outcome = await cleanupAppliedWorktreeCopy({ remove });
    expect(remove).not.toHaveBeenCalled();
    expect(outcome).toEqual({ copyState: 'present' });
  });

  it('maps remove failures to cleanup-pending without throwing', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('cleanup refused'));
    const outcome = await cleanupAppliedWorktreeCopy({
      resultRef: RESULT_REF,
      remove,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(outcome.copyState).toBe('cleanup-pending');
    expect(outcome.warning).toContain('copy cleanup pending');
    expect(outcome.warning).toContain('cleanup refused');
  });
});

describe('settleAppliedWorktreeCopy', () => {
  it('marks applied and reports a non-fatal cleanup warning when remove throws', async () => {
    const removeWorktree = vi.fn().mockRejectedValue(new Error('cleanup refused'));
    const keepWorktree = vi.fn().mockResolvedValue(undefined);
    const onRemoved = vi.fn();

    const settled = await settleAppliedWorktreeCopy({
      result: createAppliedResult(),
      changedFiles: ['src/a.ts'],
      worktreePath: '/tmp/worktree',
      removeWorktree,
      keepWorktree,
      onRemoved,
    });

    expect(settled.integrationStatus).toBe('applied');
    expect(settled.changedFiles).toEqual(['src/a.ts']);
    expect(settled.error).toContain('copy cleanup pending');
    expect(onRemoved).not.toHaveBeenCalled();
    expect(keepWorktree).toHaveBeenCalledTimes(1);
  });
});
