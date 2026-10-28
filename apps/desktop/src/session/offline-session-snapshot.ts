/**
 * Whether the sidebar is currently showing the device-local session list
 * snapshot instead of a live Host list, shared between the hook that
 * restores it, the sidebar notice and the guards on session actions.
 */
import { useSyncExternalStore } from 'react';
import { showInfoNotification } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale-id';
import type { SidebarNotice } from '../sidebar/sidebar-notice';
import { formatSnapshotSyncTime } from './session-list-snapshot';

export type OfflineSessionSnapshot = { savedAt: string };

export const OFFLINE_SNAPSHOT_NOTICE_ID = 'offline-session-snapshot';

let active: OfflineSessionSnapshot | null = null;
const listeners = new Set<() => void>();

export function setOfflineSessionSnapshot(next: OfflineSessionSnapshot | null): void {
  if (active?.savedAt === next?.savedAt) return;
  active = next;
  for (const listener of listeners) listener();
}

export function getOfflineSessionSnapshot(): OfflineSessionSnapshot | null {
  return active;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOfflineSessionSnapshot(): OfflineSessionSnapshot | null {
  return useSyncExternalStore(subscribe, getOfflineSessionSnapshot, getOfflineSessionSnapshot);
}

const COPY = {
  'zh-CN': {
    title: '离线快照',
    message: (time: string) => `连不上 Host，显示的是上次同步（${time}）的会话列表。`,
    blocked: '连上 Host 后才能打开',
  },
  en: {
    title: 'Offline snapshot',
    message: (time: string) =>
      `Host unreachable. Showing the session list from the last sync (${time}).`,
    blocked: 'Connect to the Host to open this',
  },
} as const;

export function offlineSnapshotNotice(
  snapshot: OfflineSessionSnapshot,
  locale: DesktopLocale,
  now: Date = new Date(),
): SidebarNotice {
  const copy = COPY[locale];
  return {
    id: OFFLINE_SNAPSHOT_NOTICE_ID,
    tone: 'info',
    title: copy.title,
    message: copy.message(formatSnapshotSyncTime(snapshot.savedAt, locale, now)),
  };
}

/**
 * Snapshot rows are read-only: opening, pinning or archiving one needs the
 * Host. Returns true (and says so) when the action must stop here.
 */
export function blockedByOfflineSessionSnapshot(locale: DesktopLocale): boolean {
  if (active === null) return false;
  showInfoNotification(COPY[locale].blocked);
  return true;
}
