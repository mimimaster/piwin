/**
 * Pure orchestration view for async subagent work under one parent session.
 *
 * Reducers store Host-normalized records; React surfaces consume this derived
 * view for composer pills, Tasks tabs, and transcript anchors without
 * re-interpreting tool cards or child summaries independently.
 */
import type { SessionSummary, SubagentActivityView, SubagentInvocation } from '@piwin/contracts';
import type { SubagentStreamState } from './chat-reducer';
import {
  deriveSubagentLatestActivity,
  invocationStatusToExecutionStatus,
  isOrchestrationExecutionActive,
  preferSubagentInvocation,
  resolveSubagentLifecycleAxes,
  subagentCardAnchorId,
  type ActiveSubagentStatus,
} from './subagent-activity-model.js';

export type SubagentOrchestrationExecutionStatus = ActiveSubagentStatus | 'starting';

export type SubagentOrchestrationItem = {
  /** Stable transcript anchor — invocation.id for async starts. */
  anchorId: string;
  runId?: string;
  invocationId?: string;
  childSessionId?: string;
  title: string;
  role?: string;
  activity: string;
  executionStatus: SubagentOrchestrationExecutionStatus;
  summaryStatus?: string;
  integrationStatus?: string;
  startedAt?: string;
  updatedAt: string;
};

export type SubagentOrchestrationView = {
  items: SubagentOrchestrationItem[];
  activeCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  reportPendingCount: number;
  integrationPendingCount: number;
};

export type DeriveSubagentOrchestrationInput = {
  parentSessionId: string;
  invocations: Record<string, SubagentInvocation>;
  children: Record<string, SessionSummary>;
  streams: Record<string, SubagentStreamState>;
  /** Legacy sync-run transcript cards keyed by child session id. */
  legacyActivities?: readonly SubagentActivityView[];
};

/** Transcript DOM id for an invocation card — used by wait/cancel roster links. */
export function subagentInvocationDomId(invocationId: string): string {
  return `subagent-invocation-${invocationId}`;
}

const ORCHESTRATION_STATUS_ORDER: Record<SubagentOrchestrationExecutionStatus, number> = {
  queued: 0,
  starting: 1,
  running: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
};

function legacyActivityToExecutionStatus(
  state: SubagentActivityView['state'],
): SubagentOrchestrationExecutionStatus {
  switch (state) {
    case 'started':
      return 'running';
    case 'running':
      return 'running';
    case 'completed':
    case 'merged':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

function isExecutionComplete(status: SubagentOrchestrationExecutionStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isReportPending(item: SubagentOrchestrationItem): boolean {
  return isExecutionComplete(item.executionStatus) &&
    item.executionStatus === 'completed' &&
    item.summaryStatus === 'pending';
}

function isIntegrationPending(item: SubagentOrchestrationItem): boolean {
  return item.integrationStatus === 'pending' || item.integrationStatus === 'conflict';
}

function isFullyCompleted(item: SubagentOrchestrationItem): boolean {
  return (
    item.executionStatus === 'completed' &&
    !isReportPending(item) &&
    !isIntegrationPending(item)
  );
}

function shouldAttachStream(input: {
  invocation?: SubagentInvocation;
  executionStatus: SubagentOrchestrationExecutionStatus;
}): boolean {
  if (input.executionStatus !== 'queued' &&
    input.executionStatus !== 'starting' &&
    input.executionStatus !== 'running') {
    return false;
  }
  if (input.invocation === undefined) {
    return true;
  }
  return (
    input.invocation.status === 'queued' ||
    input.invocation.status === 'starting' ||
    input.invocation.status === 'running'
  );
}

function resolveInvocationTitle(input: {
  invocation: SubagentInvocation;
  child?: SessionSummary;
}): string {
  return (
    input.child?.name?.trim() ||
    input.invocation.title?.trim() ||
    input.invocation.task?.trim() ||
    input.child?.task?.trim() ||
    'Subagent task'
  );
}

function invocationItemFromRecord(input: {
  invocation: SubagentInvocation;
  child?: SessionSummary;
  stream?: SubagentStreamState;
}): SubagentOrchestrationItem {
  const lifecycle = resolveSubagentLifecycleAxes({
    invocation: input.invocation,
    ...(input.child !== undefined ? { child: input.child } : {}),
  });
  const attachedStream = shouldAttachStream({
    invocation: input.invocation,
    executionStatus: lifecycle.executionStatus,
  })
    ? input.stream
    : undefined;
  return {
    anchorId: input.invocation.id,
    runId: input.invocation.runId,
    invocationId: input.invocation.id,
    ...(input.invocation.childSessionId !== undefined
      ? { childSessionId: input.invocation.childSessionId }
      : input.child !== undefined
        ? { childSessionId: input.child.id }
        : {}),
    title: resolveInvocationTitle({
      invocation: input.invocation,
      ...(input.child !== undefined ? { child: input.child } : {}),
    }),
    ...(input.invocation.role !== undefined
      ? { role: input.invocation.role }
      : input.child?.subagentRole !== undefined
        ? { role: input.child.subagentRole }
        : {}),
    activity: deriveSubagentLatestActivity({
      invocation: input.invocation,
      ...(input.child !== undefined ? { child: input.child } : {}),
      ...(attachedStream !== undefined ? { stream: attachedStream } : {}),
    }).slice(0, 160),
    executionStatus: lifecycle.executionStatus,
    ...(lifecycle.summaryStatus !== undefined ? { summaryStatus: lifecycle.summaryStatus } : {}),
    ...(lifecycle.integrationStatus !== undefined
      ? { integrationStatus: lifecycle.integrationStatus }
      : {}),
    startedAt: input.invocation.createdAt,
    updatedAt: input.invocation.updatedAt,
  };
}

function legacyItemFromActivity(activity: SubagentActivityView): SubagentOrchestrationItem {
  return {
    anchorId: subagentCardAnchorId(activity.childSessionId),
    childSessionId: activity.childSessionId,
    title: activity.displayName,
    activity: activity.taskSummary.trim() || activity.displayName,
    executionStatus: legacyActivityToExecutionStatus(activity.state),
    ...(activity.state === 'merged' ? { summaryStatus: 'merged' } : {}),
    updatedAt: activity.updatedAt,
  };
}

function isLegacyCoveredByInvocation(
  activity: SubagentActivityView,
  invocations: readonly SubagentInvocation[],
  children: Record<string, SessionSummary>,
): boolean {
  for (const invocation of invocations) {
    if (invocation.childSessionId === activity.childSessionId) {
      return true;
    }
  }
  const child = children[activity.childSessionId];
  if (child?.subagentInvocationId !== undefined &&
    invocations.some((invocation) => invocation.id === child.subagentInvocationId)) {
    return true;
  }
  return false;
}

function sortOrchestrationItems(items: SubagentOrchestrationItem[]): SubagentOrchestrationItem[] {
  return [...items].sort((left, right) => {
    const leftActive = isOrchestrationExecutionActive(left.executionStatus) ? 0 : 1;
    const rightActive = isOrchestrationExecutionActive(right.executionStatus) ? 0 : 1;
    if (leftActive !== rightActive) {
      return leftActive - rightActive;
    }
    const statusDelta =
      ORCHESTRATION_STATUS_ORDER[left.executionStatus] -
      ORCHESTRATION_STATUS_ORDER[right.executionStatus];
    if (statusDelta !== 0) {
      return statusDelta;
    }
    const timeDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.anchorId < right.anchorId ? -1 : left.anchorId > right.anchorId ? 1 : 0;
  });
}

function countOrchestrationItems(items: readonly SubagentOrchestrationItem[]): Omit<
  SubagentOrchestrationView,
  'items'
> {
  let activeCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let reportPendingCount = 0;
  let integrationPendingCount = 0;

  for (const item of items) {
    if (isOrchestrationExecutionActive(item.executionStatus)) {
      activeCount += 1;
    }
    if (item.executionStatus === 'failed') {
      failedCount += 1;
    }
    if (item.executionStatus === 'cancelled') {
      cancelledCount += 1;
    }
    if (isReportPending(item)) {
      reportPendingCount += 1;
    }
    if (isIntegrationPending(item)) {
      integrationPendingCount += 1;
    }
    if (isFullyCompleted(item)) {
      completedCount += 1;
    }
  }

  return {
    activeCount,
    completedCount,
    failedCount,
    cancelledCount,
    reportPendingCount,
    integrationPendingCount,
  };
}

/**
 * Merge a stored invocation with a candidate push, preferring the highest
 * revision. Exported for tests and defensive derivation at UI boundaries.
 */
export function mergeSubagentInvocationRecord(
  stored: Record<string, SubagentInvocation>,
  candidate: SubagentInvocation,
): Record<string, SubagentInvocation> {
  return {
    ...stored,
    [candidate.id]: preferSubagentInvocation(stored[candidate.id], candidate),
  };
}

/** Derive one orchestration view for composer pills, Tasks tabs, and anchors. */
export function deriveSubagentOrchestrationView(
  input: DeriveSubagentOrchestrationInput,
): SubagentOrchestrationView {
  const parentInvocations = Object.values(input.invocations).filter(
    (invocation) => invocation.parentSessionId === input.parentSessionId,
  );
  const items: SubagentOrchestrationItem[] = [];

  for (const invocation of parentInvocations) {
    const child =
      invocation.childSessionId !== undefined
        ? input.children[invocation.childSessionId]
        : undefined;
    const stream =
      child !== undefined && shouldAttachStream({
        invocation,
        executionStatus: invocationStatusToExecutionStatus(invocation.status),
      })
        ? input.streams[child.id]
        : undefined;
    items.push(
      invocationItemFromRecord({
        invocation,
        ...(child !== undefined ? { child } : {}),
        ...(stream !== undefined ? { stream } : {}),
      }),
    );
  }

  for (const activity of input.legacyActivities ?? []) {
    if (isLegacyCoveredByInvocation(activity, parentInvocations, input.children)) {
      continue;
    }
    items.push(legacyItemFromActivity(activity));
  }

  const sortedItems = sortOrchestrationItems(items);
  return {
    items: sortedItems,
    ...countOrchestrationItems(sortedItems),
  };
}
