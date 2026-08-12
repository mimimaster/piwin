import type {
  SubagentInvocationActivity,
  SubagentInvocationStatus,
  SubagentTaskResult,
} from '@piwin/contracts';

export function invocationStatusForResult(
  result: SubagentTaskResult,
): SubagentInvocationStatus {
  if (result.executionStatus === 'completed') {
    if (
      result.integrationStatus === 'retained' ||
      result.integrationStatus === 'conflict'
    ) {
      return 'needs-integration';
    }
    if (result.integrationStatus === 'failed') return 'failed';
    return 'completed';
  }
  if (result.executionStatus === 'cancelled') return 'cancelled';
  if (result.executionStatus === 'queued') return 'queued';
  if (result.executionStatus === 'running') return 'running';
  return 'failed';
}

export function invocationActivityForResult(
  result: SubagentTaskResult,
): SubagentInvocationActivity {
  const status = invocationStatusForResult(result);
  if (status === 'needs-integration') {
    return {
      kind: 'needs-integration',
      ...(result.integrationStatus === 'conflict'
        ? { message: result.error ?? 'worktree integration conflicted' }
        : {}),
    };
  }
  if (status === 'completed') {
    return {
      kind: 'completed',
      ...(result.summaryPreview ? { summary: result.summaryPreview } : {}),
    };
  }
  if (status === 'cancelled') return { kind: 'cancelled' };
  if (status === 'queued') return { kind: 'queued' };
  if (status === 'running') return { kind: 'thinking' };
  return { kind: 'failed', ...(result.error ? { message: result.error } : {}) };
}
