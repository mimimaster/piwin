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
        ...(storedResult?.role ? { role: storedResult.role } : {}),
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

/** Child-session status a settled task result projects to. */
export function subagentSessionStatusForResult(
  result: Pick<SubagentTaskResult, 'executionStatus'>,
): NonNullable<SessionIndexRecord['subagentStatus']> {
  if (result.executionStatus === 'completed') return 'done';
  if (result.executionStatus === 'cancelled') return 'cancelled';
  if (result.executionStatus === 'queued' || result.executionStatus === 'running') return 'running';
  return 'failed';
}

/**
 * True when startup has nothing to repair for this task: the child's record and
 * the durable invocation already say what the stored result says. Rewriting
 * them anyway stamps every manifest, invocation revision and child session with
 * "now" on each Host launch, which restarts every age-based clock (the GC and
 * the undecided-result expiry) and reorders the child sessions by recency.
 */
export function isPersistedSubagentStateCurrent(input: {
  repair: { recordResult: boolean; result: SubagentTaskResult };
  storedResult: SubagentTaskResult | undefined;
  child: Pick<SessionIndexRecord, 'subagentStatus' | 'subagentLifecycle'>;
  invocation: SubagentInvocation | undefined;
}): boolean {
  const { repair, storedResult, child, invocation } = input;
  if (repair.recordResult) return false;
  // A result stored before child ids were recorded still needs its backfill.
  if (storedResult?.childSessionId !== repair.result.childSessionId) return false;
  const lifecycle = child.subagentLifecycle;
  if (
    lifecycle?.executionStatus !== repair.result.executionStatus ||
    lifecycle.summaryStatus !== repair.result.summaryStatus ||
    lifecycle.integrationStatus !== repair.result.integrationStatus ||
    child.subagentStatus !== subagentSessionStatusForResult(repair.result)
  ) {
    return false;
  }
  if (invocation === undefined) return true;
  return (
    invocation.status === invocationStatusForResult(repair.result) &&
    invocation.activity.kind === invocationActivityForResult(repair.result).kind &&
    invocation.childSessionId === repair.result.childSessionId
  );
}
