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
import type { PiwinConfig, ProjectRecord, ProjectWorktreeListing, SessionListOrder, SessionScope } from '@piwin/contracts';
import type { ChatUiAction } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { pushError, type NotificationAction } from '../notification-queue';
import {
  isRemoteDesktopTransport,
  mapListedProjects,
  mapListedWorktrees,
  mergeRecentProjects,
} from '../remote-session-hydrate';
import { PROJECT_SIDEBAR_GIT_CHANGED } from '../project-sidebar-events';
import { checkoutAliasPaths } from '../sidebar-repo-groups';
import {
  applyRegisteredProjectsToHiddenSuppressions,
  filterPathsAgainstSuppression,
  markPendingSidebarRemoval,
  pathSetHas,
  releasePendingSidebarRemoval,
  rememberHiddenSidebarPath,
  suppressedSidebarPaths,
} from '../sidebar-project-removal-suppression';
import {
  mapWithConcurrency,
  planLastSessionRestore,
  planProjectListRetryDelay,
  planRecentProjectSessionHydration,
  planRemoteSessionCatchUp,
  shouldApplySidebarProjectList,
  shouldHydrateInitialGeneralSessions,
} from '../workbench-session-lifecycle';

export type WorkbenchHydrateSessions = (
  projectPathOrScope?: string | { kind: 'general' } | { kind: 'project'; projectPath: string },
  options?: {
    includeArchived?: boolean;
    order?: SessionListOrder;
  },
) => Promise<unknown>;

export type UseWorkbenchSessionLifecycleArgs = {
  hostClient: HostClient;
  hostReady: boolean;
  projectPath: string | null;
  activeSessionId?: string | null;
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
    context?: { scope?: SessionScope; quiet?: boolean; projectAlreadyActivated?: boolean },
  ) => void | Promise<void>;
  showArchivedSessions: boolean;
  remoteCatchUpEpoch: number;
  saveSettingsInOrder: import('./use-settings-save-queue').SaveSettingsInOrder;
  generalWorkspacePath?: string | null;
};

export function useWorkbenchSessionLifecycle(args: UseWorkbenchSessionLifecycleArgs): {
  recentProjects: ProjectRecord[];
  worktrees: ProjectWorktreeListing[];
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
    generalWorkspacePath,
  } = args;

  const [recentProjects, setRecentProjects] = useState<ProjectRecord[]>([]);
  const [worktrees, setWorktrees] = useState<ProjectWorktreeListing[]>([]);
  const hasHydratedInitialGeneralSessions = useRef(false);
  const hasRestoredDesktopSession = useRef(false);
  const hydratedProjectKeyRef = useRef('');
  // Increments after project/remove is stored, so a list that started earlier
  // cannot paint the folder back. Paths still in flight stay hidden even when
  // that list is from the same epoch.
  const sidebarRemovalCommitEpochRef = useRef(0);
  const pendingSidebarRemovalsRef = useRef(new Set<string>());
  const hiddenSidebarPathsRef = useRef(new Set<string>());

  useEffect(() => {
    hasHydratedInitialGeneralSessions.current = false;
    hasRestoredDesktopSession.current = false;
    hydratedProjectKeyRef.current = '';
    sidebarRemovalCommitEpochRef.current = 0;
    pendingSidebarRemovalsRef.current = new Set();
    hiddenSidebarPathsRef.current = new Set();
  }, [hostClient]);

  useEffect(() => {
    if (!hostReady) {
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retriesSoFar = 0;
    let requestGeneration = 0;
    async function loadRecentProjects(): Promise<void> {
      clearTimeout(retryTimer);
      const generation = ++requestGeneration;
      const requestCommitEpoch = sidebarRemovalCommitEpochRef.current;
      const response = await hostClient.request({ type: 'project/list' });
      if (
        cancelled ||
        generation !== requestGeneration ||
        !shouldApplySidebarProjectList({
          requestCommitEpoch,
          currentCommitEpoch: sidebarRemovalCommitEpochRef.current,
        })
      ) {
        return;
      }
      let outcome: 'failed' | 'git-pending' | 'complete';
      if (response.success) {
        const fetched = mapListedProjects(response.data);
        // Only a list started after the last removal commit can prove a re-open.
        // Pending removals are never cleared by a list snapshot.
        applyRegisteredProjectsToHiddenSuppressions(
          hiddenSidebarPathsRef.current,
          fetched.map((project) => project.path),
        );
        const suppressed = suppressedSidebarPaths(
          pendingSidebarRemovalsRef.current,
          hiddenSidebarPathsRef.current,
        );
        const visibleProjects = filterPathsAgainstSuppression(fetched, suppressed);
        setRecentProjects((prev) =>
          filterPathsAgainstSuppression(
            mergeRecentProjects(prev, visibleProjects, projectPath ? [projectPath] : []),
            suppressed,
          ),
        );
        setWorktrees(filterPathsAgainstSuppression(mapListedWorktrees(response.data), suppressed));
        const data = response.data as { gitWorkspacePending?: unknown } | undefined;
        outcome = data?.gitWorkspacePending === true ? 'git-pending' : 'complete';
      } else {
        outcome = 'failed';
      }
      const delayMs = planProjectListRetryDelay({ outcome, retriesSoFar });
      if (outcome === 'failed') {
        console.warn(
          delayMs === null
            ? 'project/list failed; giving up, sidebar projects stay as they are'
            : `project/list failed; retrying in ${delayMs}ms`,
          response.success ? undefined : response.error,
        );
      }
      if (delayMs === null) {
        if (outcome === 'complete') retriesSoFar = 0;
        return;
      }
      retriesSoFar += 1;
      retryTimer = setTimeout(() => {
        void loadRecentProjects();
      }, delayMs);
    }
    void loadRecentProjects();
    const refresh = (): void => {
      retriesSoFar = 0;
      void loadRecentProjects();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener(PROJECT_SIDEBAR_GIT_CHANGED, refresh);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(PROJECT_SIDEBAR_GIT_CHANGED, refresh);
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
    const workspacePath = generalWorkspacePath?.trim() ?? '';
    const recentProjectPaths = recentProjects.map((project) => project.path);
    if (workspacePath && !recentProjectPaths.includes(workspacePath)) {
      recentProjectPaths.push(workspacePath);
    }
    const plan = planRecentProjectSessionHydration({
      hostReady,
      recentProjectPaths,
      lastHydratedKey: hydratedProjectKeyRef.current,
      catchUpEpoch: remoteCatchUpEpoch,
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
    let completed = false;
    void (async () => {
      await mapWithConcurrency(plan.projectPaths, 3, async (path) => {
        if (cancelled) return;
        await hydrateSessions(
          { kind: 'project', projectPath: path },
          { includeArchived: showArchivedSessions },
        ).catch(() => {
          // A single project failing to load should not block the rest.
        });
      });
      completed = true;
    })();
    return () => {
      cancelled = true;
      // The project list re-renders this effect (git enrichment settles, a
      // refresh lands) with the same paths. Keeping the key would make that
      // rerun `retain-only` and strand every project this pass had not
      // reached yet; clearing it lets the next run hydrate them.
      if (!completed && hydratedProjectKeyRef.current === plan.nextKey) {
        hydratedProjectKeyRef.current = '';
      }
    };
    // hydrateSessions is intentionally omitted (its identity changes with UI state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentProjects, hostReady, remoteCatchUpEpoch, generalWorkspacePath]);

  useEffect(() => {
    if (args.activeSessionId != null) {
      // A notification or user selection wins over a late startup config.
      hasRestoredDesktopSession.current = true;
      return;
    }
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
        await handleResumeSession(plan.sessionId, { scope: { kind: 'general' }, quiet: true });
      } catch (error) {
        console.warn('last session restore failed', error);
      }
    })();
  }, [args.activeSessionId, config, handleOpenProject, handleResumeSession, hostReady]);

  const handleRemoveProjectFromSidebar = useCallback(
    async (path: string): Promise<void> => {
      // A folded folder stands for every alias record of that directory;
      // removing only the visible one would make an alias pop back up.
      const aliasPaths = checkoutAliasPaths(recentProjects, path);
      const candidatePaths = [path, ...aliasPaths];
      const previousProjects = recentProjects;
      const previousWorktrees = worktrees;
      for (const candidate of candidatePaths) {
        markPendingSidebarRemoval(pendingSidebarRemovalsRef.current, candidate);
      }
      const suppressedNow = suppressedSidebarPaths(
        pendingSidebarRemovalsRef.current,
        hiddenSidebarPathsRef.current,
      );
      setRecentProjects((projects) => filterPathsAgainstSuppression(projects, suppressedNow));
      setWorktrees((listed) => filterPathsAgainstSuppression(listed, suppressedNow));

      const removedPaths = new Set<string>();
      let anyFailure = false;
      for (const candidate of candidatePaths) {
        const response = await hostClient.request({ type: 'project/remove', path: candidate });
        if (response.success) {
          removedPaths.add(candidate);
          const removedPath =
            response.data &&
            typeof response.data === 'object' &&
            'path' in response.data &&
            typeof (response.data as { path?: unknown }).path === 'string'
              ? (response.data as { path: string }).path
              : candidate;
          removedPaths.add(removedPath);
          rememberHiddenSidebarPath(hiddenSidebarPathsRef.current, candidate);
          rememberHiddenSidebarPath(hiddenSidebarPathsRef.current, removedPath);
          releasePendingSidebarRemoval(pendingSidebarRemovalsRef.current, candidate);
          releasePendingSidebarRemoval(pendingSidebarRemovalsRef.current, removedPath);
        } else {
          anyFailure = true;
          releasePendingSidebarRemoval(pendingSidebarRemovalsRef.current, candidate);
          dispatchNotification(pushError(response.error));
        }
      }

      // Keep the existing epoch guard: a pre-commit list cannot prove a re-open.
      sidebarRemovalCommitEpochRef.current += 1;
      const suppressed = suppressedSidebarPaths(
        pendingSidebarRemovalsRef.current,
        hiddenSidebarPathsRef.current,
      );
      if (anyFailure) {
        setRecentProjects(() => filterPathsAgainstSuppression(previousProjects, suppressed));
        setWorktrees(() => filterPathsAgainstSuppression(previousWorktrees, suppressed));
      } else {
        setRecentProjects((projects) => filterPathsAgainstSuppression(projects, suppressed));
        setWorktrees((listed) => filterPathsAgainstSuppression(listed, suppressed));
      }
      if (projectPath === null || !pathSetHas(removedPaths, projectPath)) {
        window.dispatchEvent(new Event(PROJECT_SIDEBAR_GIT_CHANGED));
        return;
      }

      if (
        config?.desktop?.lastSession?.scope.kind === 'project' &&
        pathSetHas(removedPaths, config.desktop.lastSession.scope.projectPath)
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
      recentProjects,
      saveSettingsInOrder,
      setConfig,
      showArchivedSessions,
      worktrees,
    ],
  );

  return { recentProjects, worktrees, setRecentProjects, handleRemoveProjectFromSidebar };
}
