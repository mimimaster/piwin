import type { SessionScope } from '@piwin/contracts';

export type SessionListQueryStatus = 'idle' | 'ready' | 'error';

export type SessionListScopeMeta = {
  totalCount: number;
  truncated: boolean;
  mutationEpoch: number;
  queryStatus: SessionListQueryStatus;
  queryError?: string;
};

export type SessionListScopeState = {
  general: SessionListScopeMeta | null;
  projects: Record<string, SessionListScopeMeta>;
};

export function createSessionListScopeState(): SessionListScopeState {
  return { general: null, projects: {} };
}

export function getSessionListScopeMeta(
  state: SessionListScopeState,
  scope: SessionScope,
): SessionListScopeMeta | null {
  return scope.kind === 'general' ? state.general : (state.projects[scope.projectPath] ?? null);
}

export function setSessionListScopeMeta(
  state: SessionListScopeState,
  scope: SessionScope,
  meta: {
    totalCount: number;
    truncated: boolean;
    mutationEpoch?: number;
    queryStatus?: SessionListQueryStatus;
    queryError?: string;
  },
): SessionListScopeState {
  const current = getSessionListScopeMeta(state, scope);
  const normalized: SessionListScopeMeta = {
    totalCount: meta.totalCount,
    truncated: meta.truncated,
    mutationEpoch: meta.mutationEpoch ?? current?.mutationEpoch ?? 0,
    queryStatus: meta.queryStatus ?? current?.queryStatus ?? 'idle',
    ...(meta.queryError !== undefined
      ? { queryError: meta.queryError }
      : meta.queryStatus === 'ready'
        ? {}
        : current?.queryError
          ? { queryError: current.queryError }
          : {}),
  };
  if (scope.kind === 'general') {
    return { ...state, general: normalized };
  }
  return {
    ...state,
    projects: {
      ...state.projects,
      [scope.projectPath]: normalized,
    },
  };
}

/** Adjust a hydrated scope's Host total. No-op when that scope is not yet hydrated. */
export function adjustSessionListScopeTotal(
  state: SessionListScopeState,
  scope: SessionScope,
  delta: number,
): SessionListScopeState {
  const current = getSessionListScopeMeta(state, scope);
  if (current === null || delta === 0) {
    return state;
  }
  const totalCount = Math.max(0, current.totalCount + delta);
  return setSessionListScopeMeta(state, scope, {
    totalCount,
    truncated: current.truncated && totalCount > 0,
    mutationEpoch: current.mutationEpoch,
  });
}

export function bumpSessionListScopeMutationEpoch(
  state: SessionListScopeState,
  scope: SessionScope,
): SessionListScopeState {
  const current = getSessionListScopeMeta(state, scope);
  return setSessionListScopeMeta(state, scope, {
    totalCount: current?.totalCount ?? 0,
    truncated: current?.truncated ?? false,
    mutationEpoch: (current?.mutationEpoch ?? 0) + 1,
  });
}

export function hiddenSessionCount(totalCount: number, residentCount: number): number {
  return Math.max(0, totalCount - residentCount);
}
