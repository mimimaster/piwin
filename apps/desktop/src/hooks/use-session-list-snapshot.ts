/**
 * Keeps the last remote session list on the device and puts it in the
 * sidebar while the Host is unreachable, so a cold start in a tunnel still
 * shows what exists. The live list replaces it through the normal hydration
 * path; see session/session-list-snapshot.ts for what is stored.
 */
import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ProjectRecord } from '@piwin/contracts';
import type { ChatUiAction, SessionListItemUi } from '../conversation/chat-reducer';
import type { HostClient } from '../host/host-client';
import {
  loadDesktopRemoteHostTarget,
  type DesktopRemoteHostTarget,
} from '../host/remote-host-session';
import { setOfflineSessionSnapshot } from '../session/offline-session-snapshot';
import {
  buildSessionListSnapshot,
  readSessionListSnapshot,
  writeSessionListSnapshot,
  type SessionListSnapshot,
} from '../session/session-list-snapshot';

const SNAPSHOT_WRITE_DELAY_MS = 1_000;
/** A Host that answers this fast never shows the snapshot (and its notice). */
const SNAPSHOT_RESTORE_GRACE_MS = 800;

/** The Host book id survives address roaming; a legacy attach has only its endpoint. */
export function sessionSnapshotHostKey(target: DesktopRemoteHostTarget | undefined): string | null {
  const key = target?.hostId?.trim() || target?.endpoint.trim() || '';
  return key.length > 0 ? key : null;
}

export function snapshotRestoreActions(
  snapshot: SessionListSnapshot,
): Extract<ChatUiAction, { type: 'session/hydrate-scope' }>[] {
  const actions: Extract<ChatUiAction, { type: 'session/hydrate-scope' }>[] = [
    {
      type: 'session/hydrate-scope',
      scope: { kind: 'general' },
      sessions: snapshot.general,
      totalCount: snapshot.general.length,
      truncated: false,
    },
  ];
  for (const [projectPath, sessions] of Object.entries(snapshot.projects)) {
    actions.push({
      type: 'session/hydrate-scope',
      scope: { kind: 'project', projectPath },
      sessions,
      totalCount: sessions.length,
      truncated: false,
    });
  }
  return actions;
}

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
  // The built-in sidecar is never unreachable; only remote Hosts need this.
  const hostKey = useMemo(
    () =>
      hostClient.getTransport() === 'remote'
        ? sessionSnapshotHostKey(loadDesktopRemoteHostTarget())
        : null,
    [hostClient],
  );
  const latest = useRef(args);
  latest.current = args;

  useEffect(() => {
    if (hostKey === null) return undefined;
    const timer = setTimeout(() => {
      const current = latest.current;
      const listsEmpty =
        current.generalSessions.length === 0 &&
        Object.values(current.projectSessionsByPath).every((rows) => rows.length === 0) &&
        current.recentProjects.length === 0;
      if (current.hostReady || !listsEmpty) return;
      const snapshot = readSessionListSnapshot(deviceStorage(), hostKey);
      if (snapshot === undefined) return;
      for (const action of snapshotRestoreActions(snapshot)) current.dispatch(action);
      // Host never lists these back; mergeRecentProjects drops any it no longer has.
      current.setRecentProjects((previous) =>
        previous.length === 0 ? (snapshot.recentProjects as ProjectRecord[]) : previous,
      );
      setOfflineSessionSnapshot({ savedAt: snapshot.savedAt });
    }, SNAPSHOT_RESTORE_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setOfflineSessionSnapshot(null);
    };
  }, [hostKey]);

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
}
