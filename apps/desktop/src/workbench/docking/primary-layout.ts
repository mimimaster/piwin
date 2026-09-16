import { focusView } from './identity.js';
import type { WorkspaceIdFactory } from './ids.js';
import type { WorkspaceState } from './types.js';
import { closeView, openSessionView } from './view-commands.js';

/**
 * An unsplit stage holding at most one session view is not a docking layout: it
 * is the ordinary workbench chat. It renders the full primary chat column
 * (composer, context bar, run footer) instead of the compact pane session,
 * without pane chrome or tabs. A second stage view is a real tab strip
 * (product spec §4.1 单组多标签态); docked tools in the right panel do not
 * change this, and neither does a lone session view sitting next to them.
 */
export function isPrimaryDockingLayout(state: WorkspaceState): boolean {
  if (state.stage.kind !== 'group') return false;
  const group = state.groups[state.stage.groupId];
  if (!group || group.viewIds.length > 1) return false;
  return group.viewIds.every((viewId) => state.views[viewId]?.kind === 'session');
}

/** Session shown by the primary layout; `null` when the stage group is empty. */
export function primaryLayoutSessionId(state: WorkspaceState): string | null {
  if (state.stage.kind !== 'group') return null;
  const group = state.groups[state.stage.groupId];
  const viewId = group?.activeViewId ?? group?.viewIds[0];
  return (viewId ? state.views[viewId]?.sessionId : undefined) ?? null;
}

/** Close a view without touching the user's reopen stack (not a user close). */
function dropView(state: WorkspaceState, viewId: string): WorkspaceState {
  const closed = closeView(state, viewId);
  return { ...closed, reopenStack: state.reopenStack };
}

/**
 * Point the primary layout's lone view at the workbench's active session, so a
 * later split keeps that conversation on stage and no hidden tab keeps a second
 * compact session mounted. A tabbed or split stage belongs to the user and is
 * left untouched (same reference).
 */
export function syncPrimarySessionView(
  state: WorkspaceState,
  sessionId: string | null,
  createId: WorkspaceIdFactory,
): WorkspaceState {
  if (!isPrimaryDockingLayout(state) || state.stage.kind !== 'group') return state;
  const groupId = state.stage.groupId;
  const existingId = state.groups[groupId]?.viewIds[0];
  if (sessionId === null) {
    return existingId === undefined ? state : dropView(state, existingId);
  }
  const existing = existingId === undefined ? undefined : state.views[existingId];
  if (!existing) {
    const opened = openSessionView(state, sessionId, createId, groupId);
    return opened.ok ? opened.state : state;
  }
  if (existing.sessionId === sessionId) return state;
  // Rebinding in place keeps the view's surface host, so the chat column
  // follows the workbench session without remounting it.
  return focusView(
    { ...state, views: { ...state.views, [existing.viewId]: { ...existing, sessionId } } },
    existing.viewId,
  );
}
