/**
 * Desktop-local subagent activity model.
 *
 * One derived lifecycle/activity model drives the Working dock, the ticker,
 * the compact launcher card, and the inspector header so no surface
 * independently interprets SessionSummary or stream state. Pure and
 * unit-tested; no React, Host, or contracts mutation.
 */
import type {
  SessionSummary,
  SubagentIntegrationStatus,
  SubagentInvocation,
  SubagentInvocationActivity,
  SubagentInvocationStatus,
  SubagentSummaryStatus,
} from '@piwin/contracts';
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

/** Minimal identity needed to expand the inline session inspector. */
export type SubagentInspectorSelection = {
  childSessionId: string;
  displayName: string;
  taskSummary: string;
  /**
   * Transcript anchor that owns the expanded inline panel (parent tool call id
   * or `card:<childSessionId>` for the activity card). Keeps two anchors for
   * the same child from both claiming the expansion.
   */
  anchorId?: string;
};

/** Anchor id used by the persisted activity card for one child session. */
export function subagentCardAnchorId(childSessionId: string): string {
  return `card:${childSessionId}`;
}

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

/** Keep the highest-revision invocation when merging Host pushes. */
export function preferSubagentInvocation(
  current: SubagentInvocation | undefined,
  incoming: SubagentInvocation,
): SubagentInvocation {
  if (current === undefined || incoming.revision > current.revision) {
    return incoming;
  }
  return current;
}

/** Map durable invocation status to the shared execution presentation axis. */
export function invocationStatusToExecutionStatus(
  status: SubagentInvocationStatus,
): ActiveSubagentStatus | 'starting' {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'starting':
      return 'starting';
    case 'running':
      return 'running';
    case 'completed':
    case 'needs-integration':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

/** English activity line from a persisted invocation activity snapshot. */
export function formatInvocationActivity(activity: SubagentInvocationActivity): string {
  switch (activity.kind) {
    case 'queued':
      return 'Queued';
    case 'preparing':
      return 'Preparing workspace';
    case 'thinking':
      return 'Thinking';
    case 'responding':
      return 'Responding';
    case 'tool':
      return `Running ${activity.title ?? activity.toolName}`;
    case 'permission':
      return `Waiting for permission: ${activity.action}`;
    case 'completed':
      return activity.summary?.trim() || 'Completed';
    case 'needs-integration':
      return activity.message?.trim() || 'Changes need attention';
    case 'failed':
      return activity.message?.trim() || 'Subtask failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Derive a short activity line from stream, child, and/or invocation state. */
export function deriveSubagentLatestActivity(input: {
  child?: SessionSummary;
  stream?: SubagentStreamState;
  invocation?: SubagentInvocation;
}): string {
  const runningTool = input.stream?.tools.find((tool) => tool.status === 'running');
  if (runningTool !== undefined) {
    return `Running ${runningTool.toolName}`;
  }
  const streamText = input.stream !== undefined ? input.stream.text.trim() : '';
  if (streamText.length > 0) {
    return streamText.slice(0, 160);
  }
  if (input.invocation !== undefined) {
    return formatInvocationActivity(input.invocation.activity);
  }
  if (input.child !== undefined) {
    return input.child.summaryPreview ?? input.child.lastPreview ?? input.child.task ?? 'Subagent';
  }
  return 'Subagent';
}

/** Resolve orthogonal lifecycle axes, preferring invocation over child summaries. */
export function resolveSubagentLifecycleAxes(input: {
  invocation?: SubagentInvocation;
  child?: SessionSummary;
}): {
  executionStatus: ActiveSubagentStatus | 'starting';
  summaryStatus?: SubagentSummaryStatus;
  integrationStatus?: SubagentIntegrationStatus;
} {
  if (input.invocation !== undefined) {
    const executionStatus = invocationStatusToExecutionStatus(input.invocation.status);
    const child = input.child;
    return {
      executionStatus,
      ...(child?.subagentSummaryStatus !== undefined
        ? { summaryStatus: child.subagentSummaryStatus }
        : {}),
      ...(child?.subagentIntegrationStatus !== undefined
        ? { integrationStatus: child.subagentIntegrationStatus }
        : input.invocation.status === 'needs-integration'
          ? { integrationStatus: 'pending' as const }
          : {}),
    };
  }
  if (input.child !== undefined) {
    return {
      executionStatus: normalizeExecutionStatus(input.child),
      ...(input.child.subagentSummaryStatus !== undefined
        ? { summaryStatus: input.child.subagentSummaryStatus }
        : {}),
      ...(input.child.subagentIntegrationStatus !== undefined
        ? { integrationStatus: input.child.subagentIntegrationStatus }
        : {}),
    };
  }
  return { executionStatus: 'running' };
}

/** True when orchestration surfaces should treat work as in-flight. */
export function isOrchestrationExecutionActive(
  status: ActiveSubagentStatus | 'starting',
): boolean {
  return status === 'queued' || status === 'starting' || status === 'running';
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
export function deriveSubagentInspectorStatus(input: {
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
    const latestActivity = deriveSubagentLatestActivity({
      child,
      ...(stream !== undefined ? { stream } : {}),
    });
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
    anchorId: subagentCardAnchorId(view.childSessionId),
  };
}
