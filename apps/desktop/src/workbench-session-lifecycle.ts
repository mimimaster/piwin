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
  // Local: wait for the first config, and yield to lastSession restore when set.
  // Remote config/get is not allowed; do not wait on config === null there.
  if (!input.isRemote && (input.config === null || Boolean(input.config.desktop?.lastSession))) {
    return false;
  }
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
