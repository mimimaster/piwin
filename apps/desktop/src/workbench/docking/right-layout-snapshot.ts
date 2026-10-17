/**
 * The docked tools in the right panel follow the conversation: each session
 * remembers which tools its right group held and which one was in front.
 *
 * Snapshots record tool kinds, not view ids — the tools are singletons (the
 * browser view mirrors the one shared Host Chromium), so restoring a kind is
 * restoring the tool. Stage groups are untouched: they belong to the project.
 */
import { findSessionViewId, findViewGroupId, firstRightGroupId } from './topology.js';
import { MOVABLE_TOOL_KINDS } from './constants.js';
import type { WorkspaceIdFactory } from './ids.js';
import type { MovableToolKind, WorkspaceState, WorkspaceView } from './types.js';
import { isMovableToolKind } from './types.js';

export type RightLayoutSnapshotView = {
  kind: MovableToolKind;
  title?: string;
  boundSessionId?: string | null;
};

export type RightLayoutSnapshot = {
  views: RightLayoutSnapshotView[];
  activeKind: MovableToolKind | null;
};

export function captureRightLayout(state: WorkspaceState): RightLayoutSnapshot {
  const groupId = firstRightGroupId(state);
  const group = groupId ? state.groups[groupId] : undefined;
  if (!group) return { views: [], activeKind: null };
  const views: RightLayoutSnapshotView[] = [];
  for (const viewId of group.viewIds) {
    const view = state.views[viewId];
    if (!view || !isMovableToolKind(view.kind)) continue;
    const entry: RightLayoutSnapshotView = { kind: view.kind };
    if (view.title) entry.title = view.title;
    if (view.boundSessionId !== undefined) entry.boundSessionId = view.boundSessionId;
    views.push(entry);
  }
  const active = group.activeViewId ? state.views[group.activeViewId] : undefined;
  const activeKind = active && isMovableToolKind(active.kind) ? active.kind : null;
  return { views, activeKind };
}

/** Replace the right group's tools with `snapshot`, keeping stage tools where they are. */
export function restoreRightLayout(
  state: WorkspaceState,
  snapshot: RightLayoutSnapshot,
  createId: WorkspaceIdFactory,
): WorkspaceState {
  const groupId = firstRightGroupId(state);
  const group = groupId ? state.groups[groupId] : undefined;
  if (!groupId || !group) return state;

  const removed = new Set(group.viewIds);
  // Tools both layouts share keep their view, so a browser that stays open
  // across the switch is not remounted (that would restart its mirror).
  const keptByKind = new Map<MovableToolKind, WorkspaceView>();
  for (const viewId of group.viewIds) {
    const view = state.views[viewId];
    if (view && isMovableToolKind(view.kind)) keptByKind.set(view.kind, view);
  }
  const views: Record<string, WorkspaceView> = {};
  for (const [viewId, view] of Object.entries(state.views)) {
    if (!removed.has(viewId)) views[viewId] = view;
  }
  // A tool this session left on the stage (or another session moved there)
  // stays there; the right group must not grow a second copy of it.
  const kindsOnStage = new Set(Object.values(views).map((view) => view.kind));

  const viewIds: string[] = [];
  let activeViewId: string | null = null;
  for (const entry of snapshot.views) {
    if (kindsOnStage.has(entry.kind)) continue;
    kindsOnStage.add(entry.kind);
    const kept = keptByKind.get(entry.kind);
    const viewId = kept?.viewId ?? createId('view');
    const view: WorkspaceView = { viewId, kind: entry.kind };
    if (entry.title) view.title = entry.title;
    if (entry.boundSessionId !== undefined) view.boundSessionId = entry.boundSessionId;
    views[viewId] = view;
    removed.delete(viewId);
    viewIds.push(viewId);
    if (entry.kind === snapshot.activeKind) activeViewId = viewId;
  }

  let next: WorkspaceState = {
    ...state,
    views,
    groups: {
      ...state.groups,
      [groupId]: { ...group, viewIds, activeViewId: activeViewId ?? viewIds[0] ?? null },
    },
  };
  // Focus that pointed into the replaced tools falls back to the session.
  if (next.focusedViewId !== null && removed.has(next.focusedViewId)) {
    const sessionViewId = next.sessionTargetId
      ? findSessionViewId(next, next.sessionTargetId)
      : null;
    const sessionGroupId = sessionViewId ? findViewGroupId(next, sessionViewId) : null;
    next = {
      ...next,
      focusedViewId: sessionViewId,
      ...(sessionGroupId ? { activeGroupId: sessionGroupId } : {}),
    };
  }
  return next;
}

export function parseRightLayoutSnapshot(value: unknown): RightLayoutSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { views?: unknown; activeKind?: unknown };
  if (!Array.isArray(record.views)) return null;
  const views: RightLayoutSnapshotView[] = [];
  for (const item of record.views) {
    if (item === null || typeof item !== 'object') continue;
    const raw = item as { kind?: unknown; title?: unknown; boundSessionId?: unknown };
    const kind = toMovableToolKind(raw.kind);
    if (!kind) continue;
    const entry: RightLayoutSnapshotView = { kind };
    if (typeof raw.title === 'string') entry.title = raw.title;
    if (raw.boundSessionId === null || typeof raw.boundSessionId === 'string') {
      entry.boundSessionId = raw.boundSessionId;
    }
    views.push(entry);
  }
  return { views, activeKind: toMovableToolKind(record.activeKind) };
}

function toMovableToolKind(value: unknown): MovableToolKind | null {
  return MOVABLE_TOOL_KINDS.find((kind) => kind === value) ?? null;
}
