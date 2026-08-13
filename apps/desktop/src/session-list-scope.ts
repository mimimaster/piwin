import type { SessionScope } from '@piwin/contracts';

export type SessionListScopeMeta = {
  totalCount: number;
  truncated: boolean;
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
  meta: SessionListScopeMeta,
): SessionListScopeState {
  if (scope.kind === 'general') {
    return { ...state, general: meta };
  }
  return {
    ...state,
    projects: {
      ...state.projects,
      [scope.projectPath]: meta,
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
  });
}

export function hiddenSessionCount(totalCount: number, residentCount: number): number {
  return Math.max(0, totalCount - residentCount);
}
