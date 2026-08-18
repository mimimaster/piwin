import {
  ACTIVITY_SUMMARY_DEFAULT_MAX_ITEMS,
  ACTIVITY_SUMMARY_MAX_ITEMS,
  readActivitySummaryData,
  sanitizeActivityPermissionAction,
  type ActivitySummaryData,
  type ActivitySummaryItem,
  type SessionRunPhase,
} from '@piwin/contracts';

export type ActivitySummaryRunInput = {
  sessionId: string;
  runId: string;
  status: 'queued' | 'running' | 'cancelling';
  phase?: SessionRunPhase;
};

export type ActivitySummaryPermissionInput = {
  sessionId: string;
  requestId: string;
  action: string;
};

export function clampActivitySummaryMaxItems(maxItems: number | undefined): number {
  if (typeof maxItems !== 'number' || !Number.isSafeInteger(maxItems) || maxItems < 1) {
    return ACTIVITY_SUMMARY_DEFAULT_MAX_ITEMS;
  }
  return Math.min(maxItems, ACTIVITY_SUMMARY_MAX_ITEMS);
}

/**
 * Merge live foreground runs with pending permissions into a bounded,
 * path-free Inbox projection. Permission `detail` is intentionally omitted.
 */
export function projectActivitySummary(input: {
  runs: readonly ActivitySummaryRunInput[];
  pendingPermissions: readonly ActivitySummaryPermissionInput[];
  maxItems?: number;
}): ActivitySummaryData {
  const maxItems = clampActivitySummaryMaxItems(input.maxItems);
  const bySession = new Map<string, ActivitySummaryItem>();

  for (const run of input.runs) {
    if (run.sessionId.length === 0 || run.runId.length === 0) {
      continue;
    }
    if (bySession.has(run.sessionId)) {
      continue;
    }
    const item: ActivitySummaryItem = {
      sessionId: run.sessionId,
      runId: run.runId,
      status: run.status,
      pendingPermission: false,
    };
    if (run.phase !== undefined) {
      item.phase = run.phase;
    }
    bySession.set(run.sessionId, item);
  }

  for (const pending of input.pendingPermissions) {
    if (pending.sessionId.length === 0 || pending.requestId.length === 0) {
      continue;
    }
    const existing = bySession.get(pending.sessionId);
    const action = sanitizeActivityPermissionAction(pending.action);
    if (existing !== undefined) {
      existing.pendingPermission = true;
      if (existing.permissionRequestId === undefined) {
        existing.permissionRequestId = pending.requestId;
        if (action !== undefined) {
          existing.permissionAction = action;
        }
      }
      continue;
    }
    const item: ActivitySummaryItem = {
      sessionId: pending.sessionId,
      pendingPermission: true,
      permissionRequestId: pending.requestId,
    };
    if (action !== undefined) {
      item.permissionAction = action;
    }
    bySession.set(pending.sessionId, item);
  }

  const items = [...bySession.values()].sort(compareActivityItems);
  const truncated = items.length > maxItems;
  return readActivitySummaryData({
    items: truncated ? items.slice(0, maxItems) : items,
    truncated,
  });
}

function compareActivityItems(left: ActivitySummaryItem, right: ActivitySummaryItem): number {
  if (left.pendingPermission !== right.pendingPermission) {
    return left.pendingPermission ? -1 : 1;
  }
  return left.sessionId.localeCompare(right.sessionId);
}
