import type { Dispatch } from 'react';
import type { InkstoneAction } from '../inkstone-state.js';
import { formatClock } from './host-bridge.js';
import type { InkstoneHostContextValue } from './inkstone-host-context.js';

export const OFFLINE_OPEN_MESSAGE = '连上 Host 后才能打开';

/**
 * Rows from the offline snapshot are read-only: opening one needs the Host to
 * resume it. Returns true (and tells the user) when the tap must stop here.
 */
export function blockedByOfflineSnapshot(
  hostCtx: Pick<InkstoneHostContextValue, 'offlineSnapshot'>,
  dispatch: Dispatch<InkstoneAction>,
): boolean {
  if (hostCtx.offlineSnapshot === undefined) return false;
  dispatch({ type: 'toast', message: OFFLINE_OPEN_MESSAGE });
  return true;
}

/** "上次同步 14:05", or with the date when it was not today. */
export function formatSnapshotAge(savedAt: string, now: Date = new Date()): string {
  const saved = new Date(savedAt);
  if (Number.isNaN(saved.getTime())) return '上次同步时间未知';
  const time = formatClock(savedAt);
  const sameDay = saved.toDateString() === now.toDateString();
  return sameDay
    ? `上次同步 ${time}`
    : `上次同步 ${saved.getMonth() + 1}月${saved.getDate()}日 ${time}`;
}
