/**
 * Keeps the last session list on the device and restores it immediately,
 * including while the local sidecar is starting. The live list replaces it through the normal hydration
 * path; see session/session-list-snapshot.ts for what is stored.
 */
import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ProjectRecord } from '@piwin/contracts';
import type { ChatUiAction, SessionListItemUi } from '../conversation/chat-reducer';
import type { HostClient } from '../host/host-client';
import { sessionCacheHostKey } from '../session/session-cache-host.js';
import { setOfflineSessionSnapshot } from '../session/offline-session-snapshot';
import {
  buildSessionListSnapshot,
  readSessionListSnapshot,
  snapshotRestoreActions,
  writeSessionListSnapshot,
} from '../session/session-list-snapshot';

export { sessionSnapshotHostKey } from '../session/session-cache-host.js';
export { snapshotRestoreActions } from '../session/session-list-snapshot.js';

const SNAPSHOT_WRITE_DELAY_MS = 1_000;
/** Delay only the offline notice; cached rows must be visible immediately. */
const SNAPSHOT_RESTORE_GRACE_MS = 800;

function deviceStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function useSessionListSnapshot(args: {
  hostClient: HostClient;
  hostReady: boolean;
  generalSessions: SessionListItemUi[];
  projectSessionsByPath: Record<string, SessionListItemUi[]>;
  recentProjects: ProjectRecord[];
  setRecentProjects: Dispatch<SetStateAction<ProjectRecord[]>>;
  dispatch: Dispatch<ChatUiAction>;
}): void {
  const { hostClient, hostReady, generalSessions, projectSessionsByPath, recentProjects } = args;
  const hostKey = useMemo(() => sessionCacheHostKey(hostClient), [hostClient]);
  const latest = useRef(args);
  latest.current = args;

  useEffect(() => {
    if (hostKey === null) return undefined;
    const current = latest.current;
    const snapshot = readSessionListSnapshot(deviceStorage(), hostKey);
    if (snapshot === undefined) return undefined;
    const listsEmpty =
      current.generalSessions.length === 0 &&
      Object.values(current.projectSessionsByPath).every((rows) => rows.length === 0) &&
      current.recentProjects.length === 0;
    if (!current.hostReady) {
      if (listsEmpty) {
        for (const action of snapshotRestoreActions(snapshot)) current.dispatch(action);
      }
      current.setRecentProjects((previous) =>
        previous.length === 0 ? (snapshot.recentProjects as ProjectRecord[]) : previous,
      );
    }
    const timer = setTimeout(() => {
      if (latest.current.hostReady || hostClient.getTransport() !== 'remote') return;
      setOfflineSessionSnapshot({ savedAt: snapshot.savedAt });
    }, SNAPSHOT_RESTORE_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setOfflineSessionSnapshot(null);
    };
  }, [hostClient, hostKey]);

  useEffect(() => {
    if (hostReady) setOfflineSessionSnapshot(null);
  }, [hostReady]);

  useEffect(() => {
    if (hostKey === null || !hostReady) return undefined;
    const timer = setTimeout(() => {
      writeSessionListSnapshot(
        deviceStorage(),
        hostKey,
        buildSessionListSnapshot({
          general: generalSessions,
          projectSessionsByPath,
          recentProjects,
        }),
      );
    }, SNAPSHOT_WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hostKey, hostReady, generalSessions, projectSessionsByPath, recentProjects]);

  useEffect(() => {
    if (hostKey === null) return undefined;
    const flush = (): void => {
      const current = latest.current;
      if (!current.hostReady || current.hostClient !== hostClient) return;
      writeSessionListSnapshot(deviceStorage(), hostKey, buildSessionListSnapshot({
        general: current.generalSessions,
        projectSessionsByPath: current.projectSessionsByPath,
        recentProjects: current.recentProjects,
      }));
    };
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [hostClient, hostKey]);
}
