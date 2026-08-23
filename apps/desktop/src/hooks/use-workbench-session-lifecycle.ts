/**
 * Session list hydrate, last-session restore, and recent-project listing.
 * Guards are the pure functions in workbench-session-lifecycle.ts — do not
 * put hydrateSessions in the cold-start / folder-tree effect deps.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { PiwinConfig, ProjectRecord, SessionListOrder, SessionScope } from '@piwin/contracts';
import type { ChatUiAction } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { pushError, type NotificationAction } from '../notification-queue';
import {
  isRemoteDesktopTransport,
  mapListedProjects,
  mergeRecentProjects,
} from '../remote-session-hydrate';
import {
  planLastSessionRestore,
  planRecentProjectSessionHydration,
  planRemoteSessionCatchUp,
  shouldHydrateInitialGeneralSessions,
} from '../workbench-session-lifecycle';

export type WorkbenchHydrateSessions = (
  projectPathOrScope?: string | { kind: 'general' } | { kind: 'project'; projectPath: string },
  options?: {
    includeArchived?: boolean;
    order?: SessionListOrder;
    fillActiveList?: boolean;
  },
) => Promise<unknown>;

export type UseWorkbenchSessionLifecycleArgs = {
  hostClient: HostClient;
  hostReady: boolean;
  projectPath: string | null;
  config: PiwinConfig | null;
  setConfig: Dispatch<SetStateAction<PiwinConfig | null>>;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  hydrateSessions: WorkbenchHydrateSessions;
  handleOpenProject: (
    path: string,
    options?: {
      autoTrust?: boolean;
      resumeSessionId?: string;
      switchSession?: boolean;
      quiet?: boolean;
    },
  ) => Promise<void>;
  handleResumeSession: (
    sessionId: string,
    context?: { scope?: SessionScope; quiet?: boolean },
  ) => void | Promise<void>;
  showArchivedSessions: boolean;
  remoteCatchUpEpoch: number;
  saveSettingsInOrder: import('./use-settings-save-queue').SaveSettingsInOrder;
};

export function useWorkbenchSessionLifecycle(args: UseWorkbenchSessionLifecycleArgs): {
  recentProjects: ProjectRecord[];
  setRecentProjects: Dispatch<SetStateAction<ProjectRecord[]>>;
  handleRemoveProjectFromSidebar: (projectPath: string) => Promise<void>;
} {
  const {
    hostClient,
    hostReady,
    projectPath,
    config,
    setConfig,
    dispatch,
    dispatchNotification,
    hydrateSessions,
    handleOpenProject,
    handleResumeSession,
    showArchivedSessions,
    remoteCatchUpEpoch,
    saveSettingsInOrder,
  } = args;

  const [recentProjects, setRecentProjects] = useState<ProjectRecord[]>([]);
  const hasHydratedInitialGeneralSessions = useRef(false);
  const hasRestoredDesktopSession = useRef(false);
  const hydratedProjectKeyRef = useRef('');

  useEffect(() => {
    hasHydratedInitialGeneralSessions.current = false;
    hasRestoredDesktopSession.current = false;
    hydratedProjectKeyRef.current = '';
  }, [hostClient]);

  useEffect(() => {
    if (!hostReady) {
      return;
    }
    let cancelled = false;
    async function loadRecentProjects(): Promise<void> {
      const response = await hostClient.request({ type: 'project/list' });
      if (cancelled) {
        return;
      }
      if (!response.success) {
        console.warn('project/list failed; sidebar projects stay empty', response.error);
        return;
      }
      const fetched = mapListedProjects(response.data);
      setRecentProjects((prev) =>
        mergeRecentProjects(prev, fetched, projectPath ? [projectPath] : []),
      );
    }
    void loadRecentProjects();
    return () => {
      cancelled = true;
    };
  }, [hostClient, hostReady, projectPath]);

  useEffect(() => {
    if (
      !shouldHydrateInitialGeneralSessions({
        hostReady,
        projectPath,
        alreadyHydrated: hasHydratedInitialGeneralSessions.current,
        isRemote: isRemoteDesktopTransport(hostClient.getTransport()),
        config,
      })
    ) {
      return;
    }
    hasHydratedInitialGeneralSessions.current = true;
    void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
    // hydrateSessions is intentionally omitted; its identity changes with UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, hostClient, hostReady, projectPath]);

  useEffect(() => {
    const plan = planRemoteSessionCatchUp({
      catchUpEpoch: remoteCatchUpEpoch,
      hostReady,
      isRemote: isRemoteDesktopTransport(hostClient.getTransport()),
      projectPath,
    });
    if (plan.kind === 'skip') {
      return;
    }
    hasHydratedInitialGeneralSessions.current = false;
    hydratedProjectKeyRef.current = '';
    if (plan.kind === 'reset-flags') {
      return;
    }
    hasHydratedInitialGeneralSessions.current = true;
    void hydrateSessions(plan.scope, { includeArchived: showArchivedSessions });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteCatchUpEpoch, hostReady]);

  useEffect(() => {
    const plan = planRecentProjectSessionHydration({
      hostReady,
      recentProjectPaths: recentProjects.map((project) => project.path),
      lastHydratedKey: hydratedProjectKeyRef.current,
    });
    if (plan.kind === 'skip') {
      return;
    }
    dispatch({
      type: 'session/retain-project-paths',
      projectPaths: plan.projectPaths,
    });
    if (plan.kind === 'retain-only') {
      return;
    }
    hydratedProjectKeyRef.current = plan.nextKey;
    let cancelled = false;
    void (async () => {
      for (const path of plan.projectPaths) {
        if (cancelled) return;
        await hydrateSessions(
          { kind: 'project', projectPath: path },
          { includeArchived: showArchivedSessions },
        ).catch(() => {
          // A single project failing to load should not block the rest.
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // hydrateSessions is intentionally omitted (its identity changes with UI state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentProjects, hostReady]);

  useEffect(() => {
    const plan = planLastSessionRestore({
      hostReady,
      config,
      alreadyRestored: hasRestoredDesktopSession.current,
    });
    if (plan.kind === 'skip') {
      return;
    }
    hasRestoredDesktopSession.current = true;
    if (plan.kind === 'consume-without-restore') {
      return;
    }
    void (async () => {
      try {
        if (plan.kind === 'restore-project') {
          await handleOpenProject(plan.projectPath, {
            autoTrust: false,
            resumeSessionId: plan.sessionId,
            quiet: true,
          });
          return;
        }
        dispatch({ type: 'project/clear' });
        await hydrateSessions({ kind: 'general' }, { includeArchived: false });
        await handleResumeSession(plan.sessionId, { quiet: true });
      } catch (error) {
        console.warn('last session restore failed', error);
      }
    })();
  }, [config, dispatch, handleOpenProject, handleResumeSession, hydrateSessions, hostReady]);

  const handleRemoveProjectFromSidebar = useCallback(
    async (path: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'project/remove',
        path,
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }

      setRecentProjects((projects) => projects.filter((project) => project.path !== path));
      if (projectPath !== path) {
        return;
      }

      if (
        config?.desktop?.lastSession?.scope.kind === 'project' &&
        config.desktop.lastSession.scope.projectPath === path
      ) {
        const nextDesktop = config.desktop ? { ...config.desktop } : {};
        delete nextDesktop.lastSession;
        const nextConfig: PiwinConfig = { ...config, desktop: nextDesktop };
        setConfig(nextConfig);
        void saveSettingsInOrder((currentConfig) => {
          const desktop = { ...(currentConfig.desktop ?? {}) };
          delete desktop.lastSession;
          return [
            {
              kind: 'replace-domain',
              domain: 'desktop',
              value: desktop as NonNullable<PiwinConfig['desktop']>,
            },
          ];
        });
      }

      dispatch({ type: 'project/clear' });
      await hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
    },
    [
      config,
      dispatch,
      dispatchNotification,
      hostClient,
      hydrateSessions,
      projectPath,
      saveSettingsInOrder,
      setConfig,
      showArchivedSessions,
    ],
  );

  return { recentProjects, setRecentProjects, handleRemoveProjectFromSidebar };
}
