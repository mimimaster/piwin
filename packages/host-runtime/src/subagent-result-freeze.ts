/**
 * Freeze a settled child workspace as Host-backed result objects.
 * Does not read parent Git HEAD. Copy cleanup must not drop these objects.
 *
 * Two representations are written, for two different readers:
 *  - the CAS holds per-file before/after bytes, which is what the Desktop diff
 *    view renders (regular files only, so symlinks and oversized blobs mark its
 *    coverage incomplete);
 *  - a Git tree plus a commit on the lease base, reachable from
 *    `refs/piwin/results/<resultId>`, which is what integration and
 *    continuation read, and which is exact for every entry type.
 *
 * The Git snapshot is the authoritative one: it is what lets the shared writer
 * slot be reset for the next task straight after a freeze without losing the
 * child's result, and what keeps the lease base reachable after the parent
 * branch is amended.
 */
import { randomUUID } from 'node:crypto';
import type { SubagentTaskResult, SubagentWorkspaceLease } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import {
  commitResultSnapshot,
  freezeWorktreeAgainstBase,
  writeWorktreeResultTree,
  type TurnChangeStore,
} from '@piwin/git';

import { findDependenciesOutsideWorktree } from './subagent-worktree-dependencies.js';

const DEPENDENCY_WARNING_PREFIX = 'dependencies-outside-worktree';

/**
 * Result facts only the freeze can know.
 *
 * A child that symlinked its dependencies to another checkout verified code it
 * did not change, so the run must not be presented to the parent as verified
 * evidence.
 */
async function dependencyWarning(worktreePath: string): Promise<string | undefined> {
  const outside = await findDependenciesOutsideWorktree(worktreePath).catch(() => []);
  if (outside.length === 0) return undefined;
  const preview = outside.slice(0, 5).join(', ');
  const suffix = outside.length > 5 ? ` (+${String(outside.length - 5)} more)` : '';
  return `${DEPENDENCY_WARNING_PREFIX}: ${preview}${suffix}`;
}

function appendWarning(verification: string | undefined, warning: string): string {
  return verification ? `${verification}\n${warning}` : warning;
}

export async function freezeSubagentChildResult(input: {
  store: TurnChangeStore;
  result: SubagentTaskResult;
  lease: SubagentWorkspaceLease;
}): Promise<SubagentTaskResult> {
  if (input.lease.mode !== 'worktree') {
    return input.result;
  }
  const frozen = await freezeWorktreeAgainstBase({
    worktreePath: input.lease.worktreePath,
    baseCommit: input.lease.baseCommit,
    store: input.store,
  });
  const changeSetId = `subagent-result-${input.result.taskId}-${randomUUID()}`;
  input.store.registerWorkspace({
    workspaceId: changeSetId,
    rootPath: input.lease.worktreePath,
    hostInstanceId: 'subagent-freeze',
    worktreePath: input.lease.worktreePath,
  });
  input.store.createAttempt({
    changeSetId,
    attemptId: changeSetId,
    sessionId: input.result.childSessionId ?? input.result.taskId,
    workspaceId: changeSetId,
  });
  input.store.publishChangeVersion({
    changeSetId,
    revision: 1,
    files: frozen.files,
    coverageComplete: frozen.coverage === 'complete',
  });
  const resultId = changeSetId;

  const warning = await dependencyWarning(input.lease.worktreePath);
  const base: SubagentTaskResult = {
    ...input.result,
    resultRef: { resultId, revision: 1 },
    childChanges: { changeSetId, revision: 1 },
    ...(warning ? { verification: appendWarning(input.result.verification, warning) } : {}),
  };

  try {
    const { tree } = await writeWorktreeResultTree({
      worktreePath: input.lease.worktreePath,
      baseCommit: input.lease.baseCommit,
    });
    const snapshot = await commitResultSnapshot({
      repoPath: input.lease.parentRepoPath,
      tree,
      baseCommit: input.lease.baseCommit,
      resultId,
    });
    return {
      ...base,
      gitSnapshot: snapshot,
      // A slot lease's copy is shared and will be reset in place, so once the
      // Git snapshot exists the copy is already effectively returned. A
      // one-off copy keeps its own lifecycle, decided by integration cleanup.
      ...(input.lease.slotId !== undefined ? { copyState: 'released' as const } : {}),
    };
  } catch (error) {
    // The result stays reviewable through the CAS, but it has no integrable
    // snapshot. Say so instead of letting apply fail later without a reason.
    return {
      ...base,
      verification: appendWarning(
        base.verification,
        `result-snapshot-unavailable: ${formatError(error)}`,
      ),
    };
  }
}
