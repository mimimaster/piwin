/**
 * Undecided write-subagent results and what can be done with them: find the
 * retained copy or frozen snapshot behind a child's result, and apply, retain
 * or discard it. Split out of host-runtime-subagent-tasks.ts, which keeps the
 * batch/seam composition; behavior is unchanged.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SessionIndexRecord,
  SubagentIntegrationStatus,
  SubagentTaskResult,
  SubagentWorkspaceLease,
} from '@piwin/contracts';
import { deleteResultSnapshotRef, removeWorktree, runGitCommand } from '@piwin/git';
import { getSessionRecord, upsertSessionRecord, createSubagentRunStore } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { indexRecordToSummary } from './session-summary-map.js';
import { reconcileSubagentBatchStatusAfterWorktreeAction } from './subagent-batch-status.js';
import { selectChildResult } from './subagent-child-result-select.js';
import {
  invocationActivityForResult,
  invocationStatusForResult,
} from './subagent-invocation-state.js';
import {
  applyStatusFromIntegration,
  type SubagentApplyWriterStatus,
} from './subagent-apply-reservation.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export async function resolveRetainedSubagentWorktreeLease(
  deps: HostRuntimeKernel,
  child: SessionIndexRecord,
): Promise<Extract<SubagentWorkspaceLease, { mode: 'worktree' }>> {
  const integrationStatus = child.subagentLifecycle?.integrationStatus;
  if (
    !child.worktreePath ||
    (integrationStatus !== 'retained' &&
      integrationStatus !== 'conflict' &&
      integrationStatus !== 'failed')
  ) {
    throw new Error(
      'subagent worktree is no longer retained; start a new isolated task to continue',
    );
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const manifests = await createSubagentRunStore({
    runsDir: join(rootDir, 'subagent-runs'),
  }).listManifests();
  const matchingLease = manifests
    .flatMap((manifest) =>
      manifest.tasks.flatMap((task) => {
        const result = manifest.results[task.id];
        const lease = manifest.leases[task.id];
        return result?.childSessionId === child.id && lease?.mode === 'worktree' ? [lease] : [];
      }),
    )
    .reverse()
    .find((lease) => lease.worktreePath === child.worktreePath);
  if (!matchingLease) {
    throw new Error(
      'subagent worktree lease is unavailable; start a new isolated task to continue',
    );
  }
  // The frozen Git snapshot is the durable copy. A live checkout is only needed
  // when there is none: a shared writer slot may have been reset or rebuilt
  // since, which is normal and not a reason to refuse.
  const snapshot = await resolveSubagentContinuationRestore(deps, child).catch(() => undefined);
  if (!snapshot && matchingLease.slotId !== undefined) {
    // A slot path always exists (it is shared), so checking it proves nothing:
    // without a frozen tree the child's own state is gone.
    throw new Error(
      'subagent result snapshot is unavailable; start a new isolated task to continue',
    );
  }
  if (!snapshot) {
    const insideWorktree = await runGitCommand({
      cwd: matchingLease.worktreePath,
      args: ['rev-parse', '--is-inside-work-tree'],
      allowFailure: true,
    });
    if (insideWorktree.stdout.trim() !== 'true') {
      throw new Error('subagent worktree is invalid; start a new isolated task to continue');
    }
  }
  return matchingLease;
}

/**
 * Latest frozen snapshot for a child, with the base it was frozen against.
 *
 * A continuation resumes in the shared writer slot, which has been reset since
 * this child last ran, so the child's state has to be checked back out of Git
 * objects. The base is the lease commit the child started from, not the
 * parent's current HEAD: restoring against a moved parent would hand the child
 * a different starting point than its predecessor had.
 */
export async function resolveSubagentContinuationRestore(
  deps: HostRuntimeKernel,
  child: SessionIndexRecord,
): Promise<{ baseCommit: string; tree: string } | undefined> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const manifests = await createSubagentRunStore({
    runsDir: join(rootDir, 'subagent-runs'),
  }).listManifests();
  const matches = manifests
    .flatMap((manifest) =>
      manifest.tasks.flatMap((task) => {
        const result = manifest.results[task.id];
        const lease = manifest.leases[task.id];
        if (
          result?.childSessionId !== child.id ||
          lease?.mode !== 'worktree' ||
          !result.gitSnapshot
        ) {
          return [];
        }
        return [
          {
            updatedAtMs: Date.parse(manifest.updatedAt) || 0,
            baseCommit: lease.baseCommit,
            tree: result.gitSnapshot.tree,
          },
        ];
      }),
    )
    .sort((left, right) => left.updatedAtMs - right.updatedAtMs);
  const latest = matches[matches.length - 1];
  return latest ? { baseCommit: latest.baseCommit, tree: latest.tree } : undefined;
}

export type SubagentWorktreeActionResult = {
  integrationStatus: SubagentIntegrationStatus;
  applyStatus: SubagentApplyWriterStatus;
};

export async function actOnSubagentWorktree(
  deps: HostRuntimeKernel,
  childSessionId: string,
  action: 'apply' | 'retain' | 'discard',
  signal?: AbortSignal,
  /**
   * One specific run/task of the child. A persistent sidekick lane reuses a
   * child across runs, so "the child's result" alone can only ever name the
   * latest one and older undecided results could never be settled.
   */
  target?: { runId: string; taskId: string },
): Promise<SubagentWorktreeActionResult> {
  const coordinator = deps.subagentIntegrationCoordinator;
  if (!coordinator) {
    throw new Error('subagent worktree integration is not available');
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const child = await getSessionRecord(indexPath, childSessionId);
  if (!child || child.kind !== 'subagent' || !child.parentSessionId) {
    throw new Error(`subagent child session not found: ${childSessionId}`);
  }
  if (
    child.subagentStatus === 'running' ||
    child.subagentLifecycle?.executionStatus === 'queued' ||
    child.subagentLifecycle?.executionStatus === 'running'
  ) {
    throw new Error('subagent is still running; wait for it to finish before handling changes');
  }

  const lease = await deps.resolveRetainedSubagentWorktreeLease(child);
  const runStore = createSubagentRunStore({ runsDir: join(rootDir, 'subagent-runs') });
  const manifests = await runStore.listManifests();
  const childResults = manifests
    .flatMap((manifest) =>
      manifest.tasks.flatMap((task) => {
        const result = manifest.results[task.id];
        const taskLease = manifest.leases[task.id];
        return result?.childSessionId === childSessionId &&
          taskLease?.mode === 'worktree' &&
          taskLease.worktreePath === lease.worktreePath
          ? [{ manifest, task, result }]
          : [];
      }),
    )
    .reverse();
  // The child's own record follows its newest result only; settling an older
  // run must not overwrite what the newer one says.
  const { entry: retainedTask, isLatest: isLatestResult } = selectChildResult(childResults, target);
  if (!retainedTask) {
    throw new Error('subagent worktree result is unavailable; start a new isolated task');
  }

  let result: SubagentTaskResult;
  if (action === 'apply') {
    result = await coordinator.integrate(
      retainedTask.result,
      lease,
      signal ? { signal } : {},
    );
  } else if (action === 'discard') {
    // A shared writer slot is not this task's to delete: discarding the result
    // returns the copy to the pool, it does not reclaim the checkout.
    if (lease.slotId === undefined) {
      await removeWorktree({
        projectPath: lease.parentRepoPath,
        worktreePath: lease.worktreePath,
        force: true,
        worktreeBranch: lease.worktreeBranch,
      });
    }
    // Nothing will read this result's snapshot again, so release the ref that
    // kept its objects alive instead of accumulating refs per decided result.
    const discardedResultId = retainedTask.result.resultRef?.resultId;
    if (discardedResultId !== undefined) {
      await deleteResultSnapshotRef({
        repoPath: lease.parentRepoPath,
        resultId: discardedResultId,
      }).catch(() => undefined);
    }
    const { worktreePath: _discardedWorktreePath, ...resultWithoutWorktree } = retainedTask.result;
    result = {
      ...resultWithoutWorktree,
      integrationStatus: 'discarded',
    };
  } else {
    await coordinator.retain(lease.worktreePath, 'retained by user');
    result = { ...retainedTask.result, integrationStatus: 'retained' };
  }

  return settleRetainedTaskResult(deps, {
    runStore,
    retainedTask,
    result,
    childSessionId,
    worktreePath: lease.worktreePath,
    isLatestResult,
  });
}

/** Everything that follows a decision about a retained result, shared by every way of making it. */
async function settleRetainedTaskResult(
  deps: HostRuntimeKernel,
  input: {
    runStore: ReturnType<typeof createSubagentRunStore>;
    retainedTask: {
      manifest: { runId: string; parentSessionId: string };
      task: { id: string };
    };
    result: SubagentTaskResult;
    childSessionId: string;
    /** Where the copy lived, when one is still on record; absent for a record-only settle. */
    worktreePath: string | undefined;
    /** The child's own record follows its newest result only. */
    isLatestResult: boolean;
  },
): Promise<SubagentWorktreeActionResult> {
  const { runStore, retainedTask, result, childSessionId, worktreePath, isLatestResult } = input;
  const indexPath = getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
  await runStore.recordResult(retainedTask.manifest.runId, retainedTask.task.id, result);
  await deps.persistSubagentTaskResult(retainedTask.manifest.parentSessionId, result);
  const refreshedManifest = await runStore.loadManifest(retainedTask.manifest.runId);
  if (refreshedManifest) {
    const results = Object.values(refreshedManifest.results);
    const nextStatus = reconcileSubagentBatchStatusAfterWorktreeAction(
      refreshedManifest.status,
      results,
    );
    if (nextStatus !== refreshedManifest.status) {
      await runStore.setStatus(refreshedManifest.runId, nextStatus);
    }
    const invocation = Object.values(refreshedManifest.invocations).find(
      (candidate) => candidate.taskId === retainedTask.task.id,
    );
    if (invocation) {
      const updatedInvocation = {
        ...invocation,
        status: invocationStatusForResult(result),
        activity: invocationActivityForResult(result),
        revision: invocation.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await runStore.recordInvocation(refreshedManifest.runId, updatedInvocation);
      deps.push({
        type: 'subagent/invocation-updated',
        parentSessionId: retainedTask.manifest.parentSessionId,
        invocation: updatedInvocation,
      });
    }
    deps.push({
      type: 'subagent/task-updated',
      runId: refreshedManifest.runId,
      parentSessionId: retainedTask.manifest.parentSessionId,
      result,
    });
    deps.push({
      type: 'subagent/batch-updated',
      runId: refreshedManifest.runId,
      parentSessionId: retainedTask.manifest.parentSessionId,
      result: {
        runId: refreshedManifest.runId,
        status: nextStatus,
        results,
      },
    });
  }

  const updated = isLatestResult ? await getSessionRecord(indexPath, childSessionId) : undefined;
  if (updated) {
    const worktreeStillExists =
      worktreePath === undefined
        ? false
        : await access(worktreePath)
            .then(() => true)
            .catch(() => false);
    if (
      result.integrationStatus === 'discarded' ||
      (result.integrationStatus === 'applied' && !worktreeStillExists)
    ) {
      delete updated.worktreePath;
      delete updated.worktreeBranch;
    }
    updated.subagentLifecycle = {
      executionStatus: updated.subagentLifecycle?.executionStatus ?? result.executionStatus,
      summaryStatus: updated.subagentLifecycle?.summaryStatus ?? result.summaryStatus,
      integrationStatus: result.integrationStatus,
    };
    updated.updatedAt = new Date().toISOString();
    await upsertSessionRecord(indexPath, updated);
    deps.push({
      type: 'subagent/updated',
      parentSessionId: retainedTask.manifest.parentSessionId,
      child: indexRecordToSummary(updated),
    });
  }
  const resultId = result.resultRef?.resultId;
  const reservationStatus =
    resultId === undefined
      ? undefined
      : deps.turnChangeRuntime?.store.getSubagentApplyReservation({ resultId })?.status;
  return {
    integrationStatus: result.integrationStatus,
    applyStatus: applyStatusFromIntegration({
      integrationStatus: result.integrationStatus,
      ...(reservationStatus === undefined ? {} : { reservationStatus }),
    }),
  };
}

/**
 * Discard one undecided result: the lead's `piwin_subagent_result_discard` and
 * the expiry of results nobody decided (see subagent-result-expiry) both land here.
 *
 * When a copy or frozen snapshot is still there this is an ordinary discard.
 * When neither is (the worktree was removed and the snapshot ref is gone) there
 * is nothing on disk to release and only the record is left; refusing would
 * leave it `retained` and re-fail on every launch.
 */
export async function discardSubagentResult(
  deps: HostRuntimeKernel,
  entry: { childSessionId: string; runId: string; taskId: string },
): Promise<SubagentWorktreeActionResult> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const child = await getSessionRecord(indexPath, entry.childSessionId);
  const reachable = child
    ? await deps.resolveRetainedSubagentWorktreeLease(child).then(
        () => true,
        () => false,
      )
    : false;
  const target = { runId: entry.runId, taskId: entry.taskId };
  if (reachable) {
    return actOnSubagentWorktree(deps, entry.childSessionId, 'discard', undefined, target);
  }

  const runStore = createSubagentRunStore({ runsDir: join(rootDir, 'subagent-runs') });
  const manifest = await runStore.loadManifest(entry.runId);
  const task = manifest?.tasks.find((candidate) => candidate.id === entry.taskId);
  const stored = manifest?.results[entry.taskId];
  const lease = manifest?.leases[entry.taskId];
  if (!manifest || !task || !stored) {
    throw new Error(`subagent result ${entry.runId}/${entry.taskId} is no longer on record`);
  }
  const resultId = stored.resultRef?.resultId;
  if (resultId !== undefined && lease?.mode === 'worktree') {
    await deleteResultSnapshotRef({ repoPath: lease.parentRepoPath, resultId }).catch(
      () => undefined,
    );
  }
  const { worktreePath: _gone, ...withoutWorktree } = stored;
  const latest = selectChildResult(
    (await runStore.listManifests()).flatMap((candidate) =>
      candidate.tasks.flatMap((candidateTask) => {
        const candidateResult = candidate.results[candidateTask.id];
        return candidateResult?.childSessionId === entry.childSessionId
          ? [{ manifest: candidate, task: candidateTask, result: candidateResult }]
          : [];
      }),
    ).reverse(),
  );
  return settleRetainedTaskResult(deps, {
    runStore,
    retainedTask: { manifest, task },
    result: { ...withoutWorktree, integrationStatus: 'discarded' },
    childSessionId: entry.childSessionId,
    worktreePath: undefined,
    isLatestResult: latest.entry?.manifest.runId === entry.runId && latest.entry.task.id === entry.taskId,
  });
}
