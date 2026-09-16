import { findSessionViewId } from './topology.js';
import type { DropSource, WorkspaceState } from './types.js';

/**
 * A sidebar session row is a docking drag source (product spec §3.1).
 *
 * An already-open session drags as its existing view, so an edge drop moves
 * that view into the new group instead of splitting in a second copy of the
 * same session. An unopened session instantiates a view on drop.
 */
export function resolveSidebarDragSource(
  state: WorkspaceState,
  sessionId: string,
  projectScopeKey?: string,
): DropSource {
  const viewId = findSessionViewId(state, sessionId);
  if (viewId) {
    return projectScopeKey === undefined
      ? { kind: 'view', viewId }
      : { kind: 'view', viewId, projectScopeKey };
  }
  return projectScopeKey === undefined
    ? { kind: 'unopened-session', sessionId }
    : { kind: 'unopened-session', sessionId, projectScopeKey };
}
