import { findViewGroupId } from './topology.js';
import type { WorkspaceState } from './types.js';

/**
 * Focusing a session view updates the send target.
 * Focusing a tool view leaves the session target locked.
 * Closing the session target never silently retargets another session.
 */
export function focusView(state: WorkspaceState, viewId: string): WorkspaceState {
  const view = state.views[viewId];
  if (!view) return state;
  const groupId = findViewGroupId(state, viewId);
  const group = groupId ? state.groups[groupId] : undefined;
  const nextGroup = group
    ? { ...group, activeViewId: viewId }
    : undefined;
  let next: WorkspaceState = {
    ...state,
    focusedViewId: viewId,
    activeGroupId: groupId ?? state.activeGroupId,
    groups: nextGroup ? { ...state.groups, [nextGroup.groupId]: nextGroup } : state.groups,
  };
  if (view.kind === 'session' && view.sessionId) {
    next = { ...next, sessionTargetId: view.sessionId };
  }
  if (next.displayMode === 'maximized' && groupId) {
    next = { ...next, maximizedGroupId: groupId };
  }
  return next;
}

export function clearSessionTargetIfViewClosed(
  state: WorkspaceState,
  closedSessionId: string | undefined,
): WorkspaceState {
  if (!closedSessionId || state.sessionTargetId !== closedSessionId) return state;
  return { ...state, sessionTargetId: null };
}

export function resolveSessionTargetId(state: WorkspaceState): string | null {
  return state.sessionTargetId;
}

export function maximizeGroup(state: WorkspaceState, groupId: string): WorkspaceState {
  if (!state.groups[groupId]) return state;
  if (state.displayMode === 'maximized' && state.maximizedGroupId === groupId) {
    return { ...state, displayMode: 'normal', maximizedGroupId: null };
  }
  return { ...state, displayMode: 'maximized', maximizedGroupId: groupId };
}

export function setDisplayMode(
  state: WorkspaceState,
  displayMode: WorkspaceState['displayMode'],
): WorkspaceState {
  if (displayMode === 'normal') {
    return { ...state, displayMode, maximizedGroupId: null };
  }
  if (displayMode === 'maximized') {
    return { ...state, displayMode, maximizedGroupId: state.activeGroupId };
  }
  return { ...state, displayMode };
}
