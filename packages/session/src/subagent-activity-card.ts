/**
 * Parent-transcript subagent activity card helpers (PSR D5).
 */
import type { SubagentActivityState, SubagentActivityView } from '@piwin/contracts';

export function formatSubagentActivityText(activity: SubagentActivityView): string {
  const lines = [
    `Subagent ${activity.state}: ${activity.displayName}`,
    activity.taskSummary ? `Task: ${activity.taskSummary}` : null,
    `childSessionId=${activity.childSessionId}`,
    activity.worktreePath ? `worktree=${activity.worktreePath}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export function mapSubagentStatusToActivityState(
  status: string | undefined,
  merged: boolean,
): SubagentActivityState {
  if (merged) {
    return 'merged';
  }
  switch (status) {
    case 'done':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'running':
      return 'running';
    default:
      return 'started';
  }
}

export function buildSubagentActivityView(input: {
  childSessionId: string;
  displayName?: string;
  task?: string;
  status?: string;
  merged?: boolean;
  worktreePath?: string;
  updatedAt?: string;
}): SubagentActivityView {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  return {
    childSessionId: input.childSessionId,
    displayName: input.displayName?.trim() || `subagent-${input.childSessionId.slice(0, 8)}`,
    taskSummary: input.task?.trim() || '(no task summary)',
    state: mapSubagentStatusToActivityState(input.status, input.merged === true),
    updatedAt,
    ...(input.worktreePath ? { worktreePath: input.worktreePath } : {}),
  };
}
