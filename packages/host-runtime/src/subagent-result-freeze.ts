/**
 * Freeze a settled child worktree as Host-backed S0/S1 objects.
 * Does not read parent Git HEAD. Copy cleanup must not drop these objects.
 */
import { randomUUID } from 'node:crypto';
import type { SubagentTaskResult, SubagentWorkspaceLease } from '@piwin/contracts';
import { freezeWorktreeAgainstBase, type TurnChangeStore } from '@piwin/git';

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
  return {
    ...input.result,
    resultRef: { resultId, revision: 1 },
    childChanges: { changeSetId, revision: 1 },
  };
}
