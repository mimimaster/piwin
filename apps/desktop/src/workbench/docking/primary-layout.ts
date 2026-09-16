import { focusView } from './identity.js';
import type { WorkspaceIdFactory } from './ids.js';
import type { WorkspaceState } from './types.js';
import { discardView, openSessionView } from './view-commands.js';

/**
 * An unsplit stage holding at most one session view is not a docking layout: it
 * is the ordinary workbench chat. It renders the full primary chat column
 * (composer, context bar, run footer) instead of the compact pane session,
 * without pane chrome or tabs. Docked tools in the right panel do not change
 * this, and neither does a lone session view sitting next to them. Extra
 * session views on an unsplit stage are collapsed by `syncPrimarySessionView`
 * — sidebar clicks switch the conversation, they do not stack tabs.
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
  return discardView(state, viewId);
}

/**
 * Sidebar clicks switch the current conversation. Extra session views on an
 * unsplit stage are leftover tab-strip state: drop them (keeping the view that
 * already matches `sessionId` when there is one) and rebind the remaining
 * view. A real split is left untouched.
 */
function collapseUnsplitExtraSessionViews(
  state: WorkspaceState,
  keepSessionId: string | null,
): WorkspaceState {
  if (state.stage.kind !== 'group') return state;
  const group = state.groups[state.stage.groupId];
  if (!group) return state;
  const sessionViewIds = group.viewIds.filter((viewId) => state.views[viewId]?.kind === 'session');
  if (sessionViewIds.length <= 1) return state;
  const matchedId =
    keepSessionId === null
      ? undefined
      : sessionViewIds.find((viewId) => state.views[viewId]?.sessionId === keepSessionId);
  const activeId = group.activeViewId;
  const keepId =
    matchedId ??
    (activeId !== null && sessionViewIds.includes(activeId) ? activeId : sessionViewIds[0]);
  if (keepId === undefined) return state;
  let next = state;
  for (const viewId of sessionViewIds) {
    if (viewId !== keepId) next = dropView(next, viewId);
  }
  return next;
}

/**
 * Point the unsplit stage at the workbench's active session, so a later split
 * keeps that conversation on stage and no leftover tab keeps a second compact
 * session mounted. A split stage belongs to the user and is left untouched
 * (same reference).
 */
export function syncPrimarySessionView(
  state: WorkspaceState,
  sessionId: string | null,
  createId: WorkspaceIdFactory,
): WorkspaceState {
  if (state.stage.kind !== 'group') return state;
  const collapsed = collapseUnsplitExtraSessionViews(state, sessionId);
  if (!isPrimaryDockingLayout(collapsed)) return collapsed === state ? state : collapsed;
  const groupId = collapsed.stage.kind === 'group' ? collapsed.stage.groupId : null;
  if (groupId === null) return collapsed;
  const existingId = collapsed.groups[groupId]?.viewIds[0];
  if (sessionId === null) {
    return existingId === undefined ? collapsed : dropView(collapsed, existingId);
  }
  const existing = existingId === undefined ? undefined : collapsed.views[existingId];
  if (!existing) {
    const opened = openSessionView(collapsed, sessionId, createId, groupId);
    return opened.ok ? opened.state : collapsed;
  }
  if (existing.sessionId === sessionId) return collapsed;
  // Rebinding in place keeps the view's surface host, so the chat column
  // follows the workbench session without remounting it.
  return focusView(
    {
      ...collapsed,
      views: { ...collapsed.views, [existing.viewId]: { ...existing, sessionId } },
    },
    existing.viewId,
  );
}
