import type {
  SessionIndexRecord,
  SubagentInvocation,
  SubagentTaskResult,
} from '@piwin/contracts';
import type { SubagentRunManifest } from '@piwin/session';
import {
  invocationActivityForResult,
  invocationStatusForResult,
} from './subagent-invocation-state.js';
import { HOST_INTERRUPTED_FAILURE } from './persisted-error-redaction.js';

type PersistedTask = SubagentRunManifest['tasks'][number];

export function selectPersistedSubagentChild(
  task: PersistedTask,
  storedResult: SubagentTaskResult | undefined,
  children: readonly SessionIndexRecord[],
  claimedChildIds: ReadonlySet<string>,
): SessionIndexRecord | undefined {
  if (storedResult?.childSessionId) {
    return children.find((child) => child.id === storedResult.childSessionId);
  }

  const candidates = children.filter(
    (child) =>
      !claimedChildIds.has(child.id) &&
      (child.subagentTaskId === task.id ||
        (child.subagentTaskId === undefined && child.task === task.task)),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function buildPersistedSubagentRepair(
  manifest: SubagentRunManifest,
  task: PersistedTask,
  storedResult: SubagentTaskResult | undefined,
  child: SessionIndexRecord,
): { result: SubagentTaskResult; recordResult: boolean } | undefined {
  const interrupted =
    manifest.status === 'running' &&
    (storedResult === undefined ||
      storedResult.executionStatus === 'queued' ||
      storedResult.executionStatus === 'running');

  if (interrupted) {
    return {
      recordResult: true,
      result: {
        runId: manifest.runId,
        taskId: task.id,
        childSessionId: child.id,
        executionStatus: 'failed',
        summaryStatus: storedResult?.summaryStatus ?? 'not-requested',
        integrationStatus:
          storedResult?.integrationStatus ??
          (child.subagentMode === 'worktree' ? 'retained' : 'not-requested'),
        error: 'interrupted by host restart',
        failure: HOST_INTERRUPTED_FAILURE,
        ...(storedResult?.profileId ? { profileId: storedResult.profileId } : {}),
        ...(storedResult?.model ? { model: storedResult.model } : {}),
        ...(storedResult?.worktreePath
          ? { worktreePath: storedResult.worktreePath }
          : child.worktreePath
            ? { worktreePath: child.worktreePath }
            : {}),
      },
    };
  }

  if (
    storedResult &&
    storedResult.executionStatus !== 'queued' &&
    storedResult.executionStatus !== 'running'
  ) {
    return {
      recordResult: false,
      result: { ...storedResult, childSessionId: child.id },
    };
  }

  return undefined;
}

export function terminalizePersistedInvocation(
  invocation: SubagentInvocation,
  result: SubagentTaskResult,
  updatedAt: string,
): SubagentInvocation {
  return {
    ...invocation,
    ...(result.childSessionId ? { childSessionId: result.childSessionId } : {}),
    status: invocationStatusForResult(result),
    activity: invocationActivityForResult(result),
    revision: invocation.revision + 1,
    updatedAt,
  };
}
