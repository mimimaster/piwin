/**
 * Desktop-local subagent activity model.
 *
 * One derived lifecycle/activity model drives the Working dock, the ticker,
 * the compact launcher card, and the inspector header so no surface
 * independently interprets SessionSummary or stream state. Pure and
 * unit-tested; no React, Host, or contracts mutation.
 */
import type { SessionSummary } from '@piwin/contracts';
import type { SubagentStreamState } from './chat-reducer';

/** Presentation status for a child session (desktop-local, not a contract). */
export type ActiveSubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Stable presentation view for one child session under a parent. */
export type ActiveSubagentView = {
  childSessionId: string;
  parentSessionId: string;
  displayName: string;
  taskSummary: string;
  status: ActiveSubagentStatus;
  /** Short, display-ready one-liner of what the child is currently doing. */
  latestActivity: string;
  runningToolName?: string;
  worktreePath?: string;
  updatedAt: string;
};

/** Minimal identity needed to open the read-only session inspector. */
export type SubagentInspectorSelection = {
  childSessionId: string;
  displayName: string;
  taskSummary: string;
};

export type SelectActiveSubagentsInput = {
  parentSessionId: string;
  children: Record<string, SessionSummary>;
  streams: Record<string, SubagentStreamState>;
};

const STATUS_ORDER: Record<ActiveSubagentStatus, number> = {
  queued: 0,
  running: 1,
  completed: 2,
  failed: 3,
  cancelled: 4,
};

/**
 * Normalize the two lifecycle representations Host provides into one
 * presentation status. CE-SUB-LIFE `subagentExecutionStatus` is the
 * authoritative orthogonal execution axis; the legacy `subagentStatus`
 * remains the fallback for children created before the split.
 */
export function normalizeExecutionStatus(child: SessionSummary): ActiveSubagentStatus {
  if (child.subagentExecutionStatus !== undefined) {
    return child.subagentExecutionStatus;
  }
  switch (child.subagentStatus) {
    case 'running':
      return 'running';
    case 'done':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'running';
  }
}

/** Present the status in the shared run-activity visual language. */
export function subagentStatusToRunKind(status: ActiveSubagentStatus): 'preparing' | 'working' | 'complete' | 'failed' | 'stopping' {
  switch (status) {
    case 'queued':
      return 'preparing';
    case 'running':
      return 'working';
    case 'completed':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'stopping';
  }
}

/**
 * Derive the inspector/header status, preferring the live stream while a
 * child is actively emitting events, then the normalized child summary.
 * Unknown children default to running (a just-launched child may not have a
 * summary yet).
 */
export function deriveSubagentDialogStatus(input: {
  child: SessionSummary | undefined;
  stream: SubagentStreamState | undefined;
}): ActiveSubagentStatus {
  if (input.stream?.streaming === true) {
    return 'running';
  }
  if (input.child !== undefined) {
    return normalizeExecutionStatus(input.child);
  }
  return 'running';
}

/**
 * Project the current child summaries into stable, ordered activity views for
 * one parent. Ordering never depends on streamed token content so animation
 * does not reshuffle on every delta: active (queued/running) first, then
 * most recently updated, then id as a deterministic tie-break.
 *
 * Only **active** children (`queued` / `running`) are returned. Terminal
 * children stay on the transcript card; the Working dock must not claim
 * completed work as still running.
 */
export function selectActiveSubagents(input: SelectActiveSubagentsInput): ActiveSubagentView[] {
  const views: ActiveSubagentView[] = [];
  for (const child of Object.values(input.children)) {
    if (child.parentSessionId !== input.parentSessionId) {
      continue;
    }
    const status = normalizeExecutionStatus(child);
    if (status !== 'queued' && status !== 'running') {
      continue;
    }
    const stream = input.streams[child.id];
    const runningTool = stream?.tools.find((tool) => tool.status === 'running');
    const streamText = stream !== undefined ? stream.text.trim() : '';
    const latestActivity =
      runningTool !== undefined
        ? `Running ${runningTool.toolName}`
        : streamText.length > 0
          ? streamText
          : child.summaryPreview ?? child.lastPreview ?? child.task ?? 'Subagent';
    views.push({
      childSessionId: child.id,
      parentSessionId: child.parentSessionId,
      displayName: child.name ?? child.task ?? 'Subagent',
      taskSummary: child.task ?? '',
      status,
      latestActivity: latestActivity.slice(0, 160),
      ...(runningTool !== undefined ? { runningToolName: runningTool.toolName } : {}),
      ...(child.worktreePath !== undefined ? { worktreePath: child.worktreePath } : {}),
      updatedAt: child.updatedAt,
    });
  }
  views.sort((left, right) => {
    const statusDelta = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }
    const timeDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.childSessionId < right.childSessionId
      ? -1
      : left.childSessionId > right.childSessionId
        ? 1
        : 0;
  });
  return views;
}

/** Build the minimal inspector identity from an activity view. */
export function toInspectorSelection(view: ActiveSubagentView): SubagentInspectorSelection {
  return {
    childSessionId: view.childSessionId,
    displayName: view.displayName,
    taskSummary: view.taskSummary,
  };
}
