import type {
  ActivitySummaryData,
  ActivitySummaryItem,
  HostPush,
  HostResponse,
  RemoteSessionSummary,
} from '@piwin/contracts';
import { readActivitySummaryData } from '@piwin/contracts';

export const ACTIVITY_SUMMARY_REFRESH_DEBOUNCE_MS = 300;

export function readActivitySummaryResponse(response: HostResponse): ActivitySummaryData {
  if (!response.success) {
    return { items: [], truncated: false };
  }
  return readActivitySummaryData(response.data);
}

export async function requestActivitySummary(client: {
  request: (command: { type: 'activity/summary' }) => Promise<HostResponse>;
}): Promise<ActivitySummaryData> {
  try {
    return readActivitySummaryResponse(await client.request({ type: 'activity/summary' }));
  } catch {
    return { items: [], truncated: false };
  }
}

export function shouldRefreshActivitySummary(push: HostPush): boolean {
  return (
    push.type === 'run/updated' ||
    push.type === 'run/terminal' ||
    push.type === 'permission/request' ||
    push.type === 'permission/resolved'
  );
}

export function resolveActivitySessionName(
  item: ActivitySummaryItem,
  sessions: readonly RemoteSessionSummary[],
): string {
  const match = sessions.find((session) => session.sessionId === item.sessionId);
  const name = match?.name?.trim();
  return name && name.length > 0 ? name : item.sessionId;
}

export function describeActivityItem(item: ActivitySummaryItem): string {
  if (item.pendingPermission) {
    return item.permissionAction === undefined ? '等待权限' : `等待权限 · ${item.permissionAction}`;
  }
  if (item.status === 'cancelling') {
    return '正在停止';
  }
  if (item.status === 'queued') {
    return '排队中';
  }
  if (item.phase === 'waiting-permission') {
    return '等待权限';
  }
  return '执行中';
}
