/**
 * Successful integrates may delete the child copy only after the S0/S1 freeze
 * exists. retainWorktree keeps the copy and does not skip integrate.
 *
 * A copy from the shared writer slot is never deleted per task: the slot is one
 * checkout reused by every task, so "cleanup" there means returning the copy to
 * the pool, which is reported as `released` rather than `removed` — the frozen
 * review data is still available and must not be treated as expired.
 */

import { formatError } from '@piwin/contracts';
import type { SubagentCopyState, SubagentResultRef, SubagentTaskResult } from '@piwin/contracts';

export type AppliedCopyCleanupInput = {
  resultRef?: SubagentResultRef;
  retainWorktree?: boolean;
  /** True when the copy belongs to the shared writer slot. */
  sharedSlot?: boolean;
};

export type AppliedCopyCleanupDecision =
  | { action: 'keep'; copyState: Extract<SubagentCopyState, 'present' | 'released'> }
  | { action: 'remove' };

export type AppliedCopyCleanupOutcome = {
  copyState: SubagentCopyState;
  warning?: string;
};

/** Spec §7.1: auto-delete applied copies only after the result snapshot exists. */
export function decideAppliedCopyCleanup(
  input: AppliedCopyCleanupInput,
): AppliedCopyCleanupDecision {
  if (input.sharedSlot === true) {
    // The slot outlives this task by design; never delete it.
    return { action: 'keep', copyState: 'released' };
  }
  if (input.retainWorktree === true || input.resultRef === undefined) {
    return { action: 'keep', copyState: 'present' };
  }
  return { action: 'remove' };
}

export async function cleanupAppliedWorktreeCopy(input: {
  resultRef?: SubagentResultRef;
  retainWorktree?: boolean;
  sharedSlot?: boolean;
  remove: () => Promise<void>;
}): Promise<AppliedCopyCleanupOutcome> {
  const decision = decideAppliedCopyCleanup(input);
  if (decision.action === 'keep') {
    return { copyState: decision.copyState };
  }

  try {
    await input.remove();
    return { copyState: 'removed' };
  } catch (error) {
    return {
      copyState: 'cleanup-pending',
      warning: `integration applied; copy cleanup pending: ${formatError(error)}`,
    };
  }
}

export async function settleAppliedWorktreeCopy(input: {
  result: SubagentTaskResult;
  changedFiles: readonly string[];
  worktreePath: string;
  retainWorktree?: boolean;
  sharedSlot?: boolean;
  removeWorktree: () => Promise<void>;
  keepWorktree: (reason: string) => Promise<void>;
  onRemoved?: () => void;
}): Promise<SubagentTaskResult> {
  const applied: SubagentTaskResult = {
    ...input.result,
    integrationStatus: 'applied',
    changedFiles: [...input.changedFiles],
    worktreePath: input.worktreePath,
  };
  const cleanup = await cleanupAppliedWorktreeCopy({
    ...(input.result.resultRef ? { resultRef: input.result.resultRef } : {}),
    ...(input.retainWorktree === true ? { retainWorktree: true } : {}),
    ...(input.sharedSlot === true ? { sharedSlot: true } : {}),
    remove: input.removeWorktree,
  });

  if (cleanup.copyState === 'removed') {
    input.onRemoved?.();
    return applied;
  }

  const keepReason =
    cleanup.warning ??
    (cleanup.copyState === 'released'
      ? 'shared writer slot; copy returned to the pool after freeze'
      : input.retainWorktree === true
        ? 'retainWorktree requested; copy kept after apply'
        : 'result snapshot missing; worktree kept');
  await input.keepWorktree(keepReason);
  const settled: SubagentTaskResult = { ...applied, copyState: cleanup.copyState };
  return cleanup.warning ? { ...settled, error: cleanup.warning } : settled;
}
