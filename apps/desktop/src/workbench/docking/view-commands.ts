import {
  REOPEN_STACK_LIMIT,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  WORKSPACE_VIEW_HARD_LIMIT,
} from './constants.js';
import { DOCKING_COPY } from './copy.js';
import { clearSessionTargetIfViewClosed, focusView } from './identity.js';
import type { WorkspaceIdFactory } from './ids.js';
import {
  collapseEmptyStageGroups,
  findSessionViewId,
  findViewGroupId,
  firstRightGroupId,
  isStageGroupId,
  listStageGroupIds,
  putGroup,
} from './topology.js';
import type {
  MovableToolKind,
  ReopenRecord,
  WorkspaceOpResult,
  WorkspaceState,
  WorkspaceView,
} from './types.js';
import { isMovableToolKind } from './types.js';

export function rejectOp(
  state: WorkspaceState,
  code: Extract<WorkspaceOpResult, { ok: false }>['code'],
  message: string,
): WorkspaceOpResult {
  return { ok: false, state, code, message };
}

export function okOp(state: WorkspaceState): WorkspaceOpResult {
  return { ok: true, state };
}

export function createWorkspaceState(createId: WorkspaceIdFactory): WorkspaceState {
  const stageGroupId = createId('group');
  const rightGroupId = createId('group');
  return {
    version: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    stage: { kind: 'group', groupId: stageGroupId },
    groups: {
      [stageGroupId]: { groupId: stageGroupId, viewIds: [], activeViewId: null },
      [rightGroupId]: { groupId: rightGroupId, viewIds: [], activeViewId: null },
    },
    views: {},
    rightPanel: {
      groupIds: [rightGroupId],
    },
    activeGroupId: stageGroupId,
    focusedViewId: null,
    sessionTargetId: null,
    displayMode: 'normal',
    maximizedGroupId: null,
    reopenStack: [],
  };
}

export function insertView(
  state: WorkspaceState,
  groupId: string,
  view: WorkspaceView,
  index?: number,
): WorkspaceState {
  const group = state.groups[groupId];
  if (!group) return state;
  const viewIds = group.viewIds.filter((id) => id !== view.viewId);
  const insertAt = index === undefined ? viewIds.length : Math.max(0, Math.min(index, viewIds.length));
  viewIds.splice(insertAt, 0, view.viewId);
  return {
    ...state,
    views: { ...state.views, [view.viewId]: view },
    groups: {
      ...state.groups,
      [groupId]: { ...group, viewIds, activeViewId: view.viewId },
    },
  };
}

export function detachView(state: WorkspaceState, viewId: string): WorkspaceState {
  const groupId = findViewGroupId(state, viewId);
  if (!groupId) return state;
  const group = state.groups[groupId];
  if (!group) return state;
  const viewIds = group.viewIds.filter((id) => id !== viewId);
  const closedIndex = group.viewIds.indexOf(viewId);
  const fallback =
    viewIds[closedIndex] ?? viewIds[closedIndex - 1] ?? viewIds[viewIds.length - 1] ?? null;
  return putGroup(state, { ...group, viewIds, activeViewId: fallback });
}

/** Close a view without pushing the reopen stack (layout recovery, not a user close). */
export function discardView(state: WorkspaceState, viewId: string): WorkspaceState {
  const closed = closeView(state, viewId);
  return { ...closed, reopenStack: state.reopenStack };
}

function groupSessionViewId(state: WorkspaceState, groupId: string): string | undefined {
  return state.groups[groupId]?.viewIds.find((viewId) => state.views[viewId]?.kind === 'session');
}

export function openSessionView(
  state: WorkspaceState,
  sessionId: string,
  createId: WorkspaceIdFactory,
  targetGroupId?: string,
): WorkspaceOpResult {
  const existing = findSessionViewId(state, sessionId);
  if (existing) return okOp(focusView(state, existing));
  const groupId =
    (targetGroupId && isStageGroupId(state, targetGroupId) ? targetGroupId : null) ??
    (isStageGroupId(state, state.activeGroupId) ? state.activeGroupId : listStageGroupIds(state.stage)[0]);
  if (!groupId) return rejectOp(state, 'missing-target', DOCKING_COPY.illegal);
  const occupantId = groupSessionViewId(state, groupId);
  if (occupantId) {
    const occupant = state.views[occupantId];
    if (!occupant) return rejectOp(state, 'missing-target', DOCKING_COPY.illegal);
    return okOp(
      focusView(
        { ...state, views: { ...state.views, [occupantId]: { ...occupant, sessionId } } },
        occupantId,
      ),
    );
  }
  if (Object.keys(state.views).length >= WORKSPACE_VIEW_HARD_LIMIT) {
    return rejectOp(state, 'view-limit', DOCKING_COPY.viewLimit);
  }
  const viewId = createId('view');
  const view: WorkspaceView = { viewId, kind: 'session', sessionId };
  return okOp(focusView(insertView(state, groupId, view), viewId));
}

export function openToolView(
  state: WorkspaceState,
  kind: MovableToolKind,
  createId: WorkspaceIdFactory,
  targetGroupId?: string,
): WorkspaceOpResult {
  // One view per tool kind, except the browser: each open is its own tab.
  // Every canvas view renders the single workbench canvas target, so opening
  // again (auto-reveal, launcher, inspector tab) must focus the existing tab
  // instead of cloning it.
  if (kind !== 'browser') {
    for (const view of Object.values(state.views)) {
      if (view.kind === kind) return okOp(focusView(state, view.viewId));
    }
  }
  if (Object.keys(state.views).length >= WORKSPACE_VIEW_HARD_LIMIT) {
    return rejectOp(state, 'view-limit', DOCKING_COPY.viewLimit);
  }
  const fallbackRight = firstRightGroupId(state);
  const groupId =
    (targetGroupId && state.groups[targetGroupId] ? targetGroupId : null) ?? fallbackRight;
  if (!groupId) return rejectOp(state, 'missing-target', DOCKING_COPY.illegal);
  const viewId = createId('view');
  const view: WorkspaceView = { viewId, kind };
  return okOp(focusView(insertView(state, groupId, view), viewId));
}

function toReopenRecord(state: WorkspaceState, viewId: string, sourceGroupId: string): ReopenRecord | null {
  const view = state.views[viewId];
  if (!view) return null;
  const record: ReopenRecord = { kind: view.kind, sourceGroupId };
  if (view.sessionId) record.sessionId = view.sessionId;
  if (view.boundSessionId !== undefined) record.boundSessionId = view.boundSessionId;
  if (view.title) record.title = view.title;
  return record;
}

export function closeView(state: WorkspaceState, viewId: string): WorkspaceState {
  const view = state.views[viewId];
  const groupId = findViewGroupId(state, viewId);
  if (!view || !groupId) return state;
  const record = toReopenRecord(state, viewId, groupId);
  let next = detachView(state, viewId);
  const { [viewId]: _removed, ...views } = next.views;
  void _removed;
  const reopenStack = record ? [record, ...state.reopenStack].slice(0, REOPEN_STACK_LIMIT) : state.reopenStack;
  next = {
    ...next,
    views,
    reopenStack,
    focusedViewId: next.focusedViewId === viewId ? (next.groups[groupId]?.activeViewId ?? null) : next.focusedViewId,
  };
  next = clearSessionTargetIfViewClosed(next, view.sessionId);
  if (isStageGroupId(next, groupId)) {
    next = collapseEmptyStageGroups(next);
  }
  return next;
}

export function reopenLastView(state: WorkspaceState, createId: WorkspaceIdFactory): WorkspaceOpResult {
  const record = state.reopenStack[0];
  if (!record) return rejectOp(state, 'missing-target', DOCKING_COPY.illegal);
  const rest = state.reopenStack.slice(1);
  const base = { ...state, reopenStack: rest };
  if (record.kind === 'session' && record.sessionId) {
    const groupId = base.groups[record.sourceGroupId] ? record.sourceGroupId : undefined;
    return openSessionView(base, record.sessionId, createId, groupId);
  }
  if (isMovableToolKind(record.kind)) {
    const preferred =
      base.groups[record.sourceGroupId] ? record.sourceGroupId : firstRightGroupId(base) ?? undefined;
    return openToolView(base, record.kind, createId, preferred);
  }
  return rejectOp(base, 'missing-target', DOCKING_COPY.illegal);
}
