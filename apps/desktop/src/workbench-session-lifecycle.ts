/**
 * Eligibility for Desktop session list / restore. Effects in the lifecycle
 * hook call these; they must not depend on hydrateSessions identity.
 */
import type { PiwinConfig, SessionScope, SessionSearchHit } from '@piwin/contracts';

export function shouldHydrateInitialGeneralSessions(input: {
  hostReady: boolean;
  projectPath: string | null;
  alreadyHydrated: boolean;
  isRemote: boolean;
  config: PiwinConfig | null;
}): boolean {
  if (!input.hostReady || input.projectPath !== null || input.alreadyHydrated) {
    return false;
  }
  // Lists are independent of config and last-session restoration. Loading them
  // immediately also lets a notification resolve while config is still pending.
  return true;
}

export type RemoteSessionCatchUpPlan =
  | { kind: 'skip' }
  | { kind: 'reset-flags' }
  | { kind: 'hydrate'; scope: SessionScope };

export function planRemoteSessionCatchUp(input: {
  catchUpEpoch: number;
  hostReady: boolean;
  isRemote: boolean;
  projectPath: string | null;
}): RemoteSessionCatchUpPlan {
  if (input.catchUpEpoch === 0 || !input.hostReady) {
    return { kind: 'skip' };
  }
  if (!input.isRemote) {
    return { kind: 'reset-flags' };
  }
  if (input.projectPath) {
    return {
      kind: 'hydrate',
      scope: { kind: 'project', projectPath: input.projectPath },
    };
  }
  return { kind: 'hydrate', scope: { kind: 'general' } };
}

const PROJECT_LIST_FAILURE_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 30_000, 30_000];
const PROJECT_LIST_GIT_PENDING_RETRY_DELAY_MS = 5_000;
const PROJECT_LIST_GIT_PENDING_MAX_RETRIES = 24;

/**
 * When to ask for `project/list` again after the sidebar load. A failed list
 * must not leave the sidebar empty for the whole app lifetime (a cold Host or
 * a git probe parked behind a macOS permission prompt both outlast the request
 * timeout); a list with git still pending re-lists until enrichment lands.
 * Returns null to stop.
 */
export function planProjectListRetryDelay(input: {
  outcome: 'failed' | 'git-pending' | 'complete';
  retriesSoFar: number;
}): number | null {
  if (input.outcome === 'failed') {
    return PROJECT_LIST_FAILURE_RETRY_DELAYS_MS[input.retriesSoFar] ?? null;
  }
  if (input.outcome === 'git-pending') {
    return input.retriesSoFar < PROJECT_LIST_GIT_PENDING_MAX_RETRIES
      ? PROJECT_LIST_GIT_PENDING_RETRY_DELAY_MS
      : null;
  }
  return null;
}

/**
 * A `project/list` that started before "remove from sidebar" finished must
 * not paint. Git enrichment makes that request slow; applying it afterwards
 * puts the folder back. `currentCommitEpoch` increments only after the host
 * has stored the removal.
 */
export function shouldApplySidebarProjectList(input: {
  requestCommitEpoch: number;
  currentCommitEpoch: number;
}): boolean {
  return input.requestCommitEpoch === input.currentCommitEpoch;
}

/**
 * A list that started in the same epoch as an in-flight removal still
 * contains the folder. Keep those paths out until the host has stored the
 * removal (the epoch check) or the removal fails and the path is dropped
 * from `pendingPaths`.
 */
export function withoutPendingSidebarRemovals<T extends { path: string }>(
  projects: readonly T[],
  pendingPaths: ReadonlySet<string>,
): T[] {
  if (pendingPaths.size === 0) {
    return projects as T[];
  }
  return projects.filter((project) => !pendingPaths.has(project.path));
}

export type RecentProjectHydrationPlan =
  | { kind: 'skip' }
  | { kind: 'retain-only'; projectPaths: string[] }
  | { kind: 'hydrate'; projectPaths: string[]; nextKey: string };

export function planRecentProjectSessionHydration(input: {
  hostReady: boolean;
  recentProjectPaths: readonly string[];
  lastHydratedKey: string;
  catchUpEpoch?: number;
}): RecentProjectHydrationPlan {
  if (!input.hostReady) {
    return { kind: 'skip' };
  }
  const projectPaths = [...input.recentProjectPaths];
  if (projectPaths.length === 0) {
    return { kind: 'retain-only', projectPaths };
  }
  const nextKey = `${input.catchUpEpoch ?? 0}\0${projectPaths.join('\0')}`;
  if (nextKey === input.lastHydratedKey) {
    return { kind: 'retain-only', projectPaths };
  }
  return { kind: 'hydrate', projectPaths, nextKey };
}

export type LastSessionRestorePlan =
  | { kind: 'skip' }
  | { kind: 'consume-without-restore' }
  | { kind: 'restore-project'; projectPath: string; sessionId: string }
  | { kind: 'restore-general'; sessionId: string };

export function planLastSessionRestore(input: {
  hostReady: boolean;
  config: PiwinConfig | null;
  alreadyRestored: boolean;
}): LastSessionRestorePlan {
  if (!input.hostReady || input.config === null || input.alreadyRestored) {
    return { kind: 'skip' };
  }
  const lastSession = input.config.desktop?.lastSession;
  if (!lastSession) {
    return { kind: 'consume-without-restore' };
  }
  if (lastSession.scope.kind === 'project') {
    return {
      kind: 'restore-project',
      projectPath: lastSession.scope.projectPath,
      sessionId: lastSession.sessionId,
    };
  }
  return { kind: 'restore-general', sessionId: lastSession.sessionId };
}

export function resolveSessionScopeHintFromSearchHits(
  hitsByScope: Record<string, SessionSearchHit[]> | null,
  sessionId: string,
): SessionScope | undefined {
  if (hitsByScope === null) {
    return undefined;
  }
  for (const hits of Object.values(hitsByScope)) {
    const hit = hits.find((candidate) => candidate.sessionId === sessionId);
    if (!hit) {
      continue;
    }
    if (hit.scope) {
      return hit.scope;
    }
    return hit.projectPath.trim().length > 0
      ? { kind: 'project', projectPath: hit.projectPath }
      : { kind: 'general' };
  }
  return undefined;
}

export type LastSessionPointer = { sessionId: string; scope: SessionScope };

export function lastSessionPersistUnchanged(
  current: PiwinConfig['desktop'] | undefined,
  next: LastSessionPointer,
): boolean {
  return (
    current?.lastSession?.sessionId === next.sessionId &&
    JSON.stringify(current.lastSession.scope) === JSON.stringify(next.scope)
  );
}

export type LastSessionPersistPlan =
  | { kind: 'skip' }
  | { kind: 'mark-synced'; lastSession: LastSessionPointer }
  | { kind: 'persist'; lastSession: LastSessionPointer };

/**
 * Persist the restore pointer once per session/scope. `settings/updated` refetches
 * the whole document and used to re-queue a `desktop` replace, which CAS-conflicts
 * with composer-profile saves and toasts as "another client changed settings".
 */
export function planLastSessionPersist(input: {
  config: PiwinConfig | null;
  activeSessionId: string | null;
  activeScope: SessionScope;
  alreadyPersisted: LastSessionPointer | null;
}): LastSessionPersistPlan {
  if (!input.config || !input.activeSessionId) {
    return { kind: 'skip' };
  }
  const lastSession: LastSessionPointer = {
    sessionId: input.activeSessionId,
    scope: input.activeScope,
  };
  if (
    lastSessionPersistUnchanged(
      input.alreadyPersisted === null ? undefined : { lastSession: input.alreadyPersisted },
      lastSession,
    )
  ) {
    return { kind: 'skip' };
  }
  if (lastSessionPersistUnchanged(input.config.desktop, lastSession)) {
    return { kind: 'mark-synced', lastSession };
  }
  return { kind: 'persist', lastSession };
}

/**
 * Bounded parallel map. One failed item must not prevent the rest.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      const item = items[current];
      if (item === undefined) {
        return;
      }
      await fn(item);
    }
  });
  await Promise.all(workers);
}
