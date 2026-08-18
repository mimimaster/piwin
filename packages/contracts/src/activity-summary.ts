import type { SessionRunPhase } from './host.js';

/** Default page size for Host-wide live activity. */
export const ACTIVITY_SUMMARY_DEFAULT_MAX_ITEMS = 32;

/** Hard ceiling for `activity/summary.maxItems` (local and remote). */
export const ACTIVITY_SUMMARY_MAX_ITEMS = 64;

export type ActivityRunStatus = 'queued' | 'running' | 'cancelling';

/**
 * One session's live work for Inbox / cockpit. Opaque ids only — never Host
 * filesystem paths or permission `detail` (those often contain commands/paths).
 */
export type ActivitySummaryItem = {
  sessionId: string;
  runId?: string;
  status?: ActivityRunStatus;
  phase?: SessionRunPhase;
  pendingPermission: boolean;
  permissionRequestId?: string;
  permissionAction?: string;
};

export type ActivitySummaryData = {
  items: ActivitySummaryItem[];
  truncated: boolean;
};

const ACTIVITY_RUN_STATUSES = new Set<string>(['queued', 'running', 'cancelling']);

const SESSION_RUN_PHASES = new Set<string>([
  'accepted',
  'preparing',
  'connecting-model',
  'waiting-first-token',
  'streaming',
  'tool-running',
  'waiting-permission',
  'pausing',
  'cancelling',
  'waiting-resource',
]);

/** Classifier tokens such as `bash` or `network:web_search`, not paths. */
const ACTIVITY_PERMISSION_ACTION = /^[a-z][a-z0-9:_-]{0,63}$/;

export function isActivityRunStatus(value: unknown): value is ActivityRunStatus {
  return typeof value === 'string' && ACTIVITY_RUN_STATUSES.has(value);
}

export function isActivitySessionRunPhase(value: unknown): value is SessionRunPhase {
  return typeof value === 'string' && SESSION_RUN_PHASES.has(value);
}

export function sanitizeActivityPermissionAction(action: string): string | undefined {
  return ACTIVITY_PERMISSION_ACTION.test(action) ? action : undefined;
}

export function readActivitySummaryData(value: unknown): ActivitySummaryData {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return { items: [], truncated: false };
  }
  const items: ActivitySummaryItem[] = [];
  for (const raw of value.items) {
    if (items.length >= ACTIVITY_SUMMARY_MAX_ITEMS) {
      break;
    }
    const item = readActivitySummaryItem(raw);
    if (item !== undefined) {
      items.push(item);
    }
  }
  return {
    items,
    truncated: value.truncated === true || value.items.length > items.length,
  };
}

export function isActivitySummaryData(value: unknown): value is ActivitySummaryData {
  const projected = readActivitySummaryData(value);
  return isRecord(value) && Array.isArray(value.items) && projected.items.length === value.items.length;
}

function readActivitySummaryItem(value: unknown): ActivitySummaryItem | undefined {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || value.sessionId.length === 0) {
    return undefined;
  }
  const pendingPermission = value.pendingPermission === true;
  const runId = typeof value.runId === 'string' && value.runId.length > 0 ? value.runId : undefined;
  if (runId === undefined && !pendingPermission) {
    return undefined;
  }
  const item: ActivitySummaryItem = {
    sessionId: value.sessionId,
    pendingPermission,
  };
  if (runId !== undefined) {
    item.runId = runId;
  }
  if (isActivityRunStatus(value.status)) {
    item.status = value.status;
  }
  if (isActivitySessionRunPhase(value.phase)) {
    item.phase = value.phase;
  }
  if (pendingPermission && typeof value.permissionRequestId === 'string' && value.permissionRequestId.length > 0) {
    item.permissionRequestId = value.permissionRequestId;
  }
  if (pendingPermission && typeof value.permissionAction === 'string') {
    const action = sanitizeActivityPermissionAction(value.permissionAction);
    if (action !== undefined) {
      item.permissionAction = action;
    }
  }
  return item;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
