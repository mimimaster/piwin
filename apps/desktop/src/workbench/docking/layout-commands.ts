import { STAGE_GROUP_HARD_LIMIT } from './constants.js';
import { DOCKING_COPY } from './copy.js';
import { clampSplitWeight } from './geometry.js';
import { focusView } from './identity.js';
import type { WorkspaceIdFactory } from './ids.js';
import {
  collapseEmptyStageGroups,
  findViewGroupId,
  firstRightGroupId,
  getGroup,
  isLegalStageTopology,
  isRightGroupId,
  isStageGroupId,
  listStageGroupIds,
  mapStageNode,
  putGroup,
  setSplitRatioOnStage,
  stageGroupCount,
} from './topology.js';
import type {
  DropEdge,
  SplitOrientation,
  StageNode,
  WorkspaceOpResult,
  WorkspaceState,
  WorkspaceTemplate,
} from './types.js';
import { isMovableToolKind } from './types.js';
import { detachView, insertView, okOp, rejectOp } from './view-commands.js';

function edgeOrientation(edge: DropEdge): SplitOrientation {
  return edge === 'left' || edge === 'right' ? 'row' : 'column';
}

function edgePlacesNewFirst(edge: DropEdge): boolean {
  return edge === 'left' || edge === 'up';
}

export function splitGroupAtEdge(
  state: WorkspaceState,
  groupId: string,
  edge: DropEdge,
  createId: WorkspaceIdFactory,
): WorkspaceOpResult {
  if (!isStageGroupId(state, groupId)) {
    return rejectOp(state, 'illegal-topology', DOCKING_COPY.illegal);
  }
  if (stageGroupCount(state.stage) >= STAGE_GROUP_HARD_LIMIT) {
    return rejectOp(state, 'stage-group-limit', DOCKING_COPY.fourLimit);
  }
  const newGroupId = createId('group');
  const newGroup = { groupId: newGroupId, viewIds: [] as string[], activeViewId: null };
  const splitId = createId('split');
  const orientation = edgeOrientation(edge);
  const incoming: StageNode = { kind: 'group', groupId: newGroupId };
  const stage = mapStageNode(state.stage, groupId, (current) => ({
    kind: 'split' as const,
    splitId,
    orientation,
    ratio: 0.5,
    first: edgePlacesNewFirst(edge) ? incoming : current,
    second: edgePlacesNewFirst(edge) ? current : incoming,
  }));
  if (!isLegalStageTopology(stage)) {
    return rejectOp(state, 'illegal-topology', DOCKING_COPY.illegal);
  }
  return okOp({
    ...state,
    stage,
    groups: { ...state.groups, [newGroupId]: newGroup },
    activeGroupId: newGroupId,
    displayMode: state.displayMode === 'maximized' ? 'normal' : state.displayMode,
    maximizedGroupId: state.displayMode === 'maximized' ? null : state.maximizedGroupId,
  });
}

export function moveViewToGroup(
  state: WorkspaceState,
  viewId: string,
  targetGroupId: string,
  index?: number,
): WorkspaceOpResult {
  const view = state.views[viewId];
  if (!view) return rejectOp(state, 'missing-target', DOCKING_COPY.illegal);
  if (!state.groups[targetGroupId]) return rejectOp(state, 'missing-target', DOCKING_COPY.illegal);
  if (view.kind === 'session' && isRightGroupId(state, targetGroupId)) {
    return rejectOp(state, 'session-not-in-right-panel', DOCKING_COPY.sessionNotInRight);
  }
  if (isStageGroupId(state, targetGroupId) && view.kind !== 'session' && !isMovableToolKind(view.kind)) {
    return rejectOp(state, 'tool-not-movable', DOCKING_COPY.toolNotMovable);
  }
  const sourceGroupId = findViewGroupId(state, viewId);
  if (sourceGroupId === targetGroupId) {
    const group = state.groups[targetGroupId];
    if (!group) return okOp(state);
    const without = group.viewIds.filter((id) => id !== viewId);
    const insertAt = index === undefined ? without.length : Math.max(0, Math.min(index, without.length));
    without.splice(insertAt, 0, viewId);
    return okOp(putGroup(state, { ...group, viewIds: without, activeViewId: viewId }));
  }
  let next = detachView(state, viewId);
  next = insertView(next, targetGroupId, view, index);
  if (sourceGroupId && isStageGroupId(next, sourceGroupId)) {
    next = collapseEmptyStageGroups(next);
  }
  return okOp(focusView(next, viewId));
}

export function moveViewToEdge(
  state: WorkspaceState,
  viewId: string,
  targetGroupId: string,
  edge: DropEdge,
  createId: WorkspaceIdFactory,
): WorkspaceOpResult {
  const view = state.views[viewId];
  if (!view) return rejectOp(state, 'missing-target', DOCKING_COPY.illegal);
  if (view.kind === 'session' && isRightGroupId(state, targetGroupId)) {
    return rejectOp(state, 'session-not-in-right-panel', DOCKING_COPY.sessionNotInRight);
  }
  if (!isStageGroupId(state, targetGroupId)) {
    return rejectOp(state, 'illegal-topology', DOCKING_COPY.illegal);
  }
  if (view.kind !== 'session' && !isMovableToolKind(view.kind)) {
    return rejectOp(state, 'tool-not-movable', DOCKING_COPY.toolNotMovable);
  }
  const sourceGroupId = findViewGroupId(state, viewId);
  const sourceGroup = sourceGroupId ? state.groups[sourceGroupId] : undefined;
  if (sourceGroupId === targetGroupId && sourceGroup && sourceGroup.viewIds.length <= 1) {
    return rejectOp(state, 'no-op', '');
  }

  let next = detachView(state, viewId);
  if (sourceGroupId && isStageGroupId(next, sourceGroupId)) {
    next = collapseEmptyStageGroups(next);
  }
  const liveTarget = next.groups[targetGroupId] ? targetGroupId : listStageGroupIds(next.stage)[0];
  if (!liveTarget) return rejectOp(state, 'missing-target', DOCKING_COPY.illegal);

  const split = splitGroupAtEdge(next, liveTarget, edge, createId);
  if (!split.ok) return split;
  next = insertView(split.state, split.state.activeGroupId, view);
  if (!isLegalStageTopology(next.stage)) {
    return rejectOp(state, 'illegal-topology', DOCKING_COPY.illegal);
  }
  return okOp(focusView(next, viewId));
}

function collectStageViewsInOrder(state: WorkspaceState): string[] {
  const ids: string[] = [];
  for (const groupId of listStageGroupIds(state.stage)) {
    const group = state.groups[groupId];
    if (!group) continue;
    for (const viewId of group.viewIds) {
      if (!ids.includes(viewId)) ids.push(viewId);
    }
  }
  return ids;
}

function removeUnusedStageGroups(state: WorkspaceState, keep: Set<string>): WorkspaceState {
  let groups = state.groups;
  let changed = false;
  for (const groupId of Object.keys(groups)) {
    if (isRightGroupId(state, groupId) || keep.has(groupId)) continue;
    const { [groupId]: _removed, ...rest } = groups;
    void _removed;
    groups = rest;
    changed = true;
  }
  return changed ? { ...state, groups } : state;
}

function buildTemplateStage(
  groupIds: string[],
  template: WorkspaceTemplate,
  createId: WorkspaceIdFactory,
): StageNode {
  const g0 = groupIds[0];
  const g1 = groupIds[1];
  const g2 = groupIds[2];
  const g3 = groupIds[3];
  if (!g0) return { kind: 'group', groupId: createId('group') };
  if (template === 'single' || groupIds.length === 1) return { kind: 'group', groupId: g0 };
  if (template === 'columns' && g1) {
    return {
      kind: 'split',
      splitId: createId('split'),
      orientation: 'row',
      ratio: 0.5,
      first: { kind: 'group', groupId: g0 },
      second: { kind: 'group', groupId: g1 },
    };
  }
  if (template === 'rows' && g1) {
    return {
      kind: 'split',
      splitId: createId('split'),
      orientation: 'column',
      ratio: 0.5,
      first: { kind: 'group', groupId: g0 },
      second: { kind: 'group', groupId: g1 },
    };
  }
  if (template === 'quad' && g1 && g2 && g3) {
    return {
      kind: 'split',
      splitId: createId('split'),
      orientation: 'column',
      ratio: 0.5,
      first: {
        kind: 'split',
        splitId: createId('split'),
        orientation: 'row',
        ratio: 0.5,
        first: { kind: 'group', groupId: g0 },
        second: { kind: 'group', groupId: g1 },
      },
      second: {
        kind: 'split',
        splitId: createId('split'),
        orientation: 'row',
        ratio: 0.5,
        first: { kind: 'group', groupId: g2 },
        second: { kind: 'group', groupId: g3 },
      },
    };
  }
  return { kind: 'group', groupId: g0 };
}

export function applyWorkspaceTemplate(
  state: WorkspaceState,
  template: WorkspaceTemplate,
  createId: WorkspaceIdFactory,
): WorkspaceState {
  const targetCount = template === 'single' ? 1 : template === 'quad' ? 4 : 2;
  const currentIds = listStageGroupIds(state.stage);
  const groupsInOrder = currentIds
    .map((id) => state.groups[id])
    .filter((group): group is NonNullable<typeof group> => Boolean(group));
  const nextIds: string[] = [];
  const nextGroups: Record<string, (typeof groupsInOrder)[number]> = {};

  if (groupsInOrder.length >= targetCount) {
    for (let index = 0; index < targetCount; index += 1) {
      const group = groupsInOrder[index];
      if (!group) continue;
      nextIds.push(group.groupId);
      nextGroups[group.groupId] = { ...group };
    }
    const lastId = nextIds[nextIds.length - 1];
    const last = lastId ? nextGroups[lastId] : undefined;
    if (last) {
      const extra = groupsInOrder.slice(targetCount).flatMap((group) => group.viewIds);
      const viewIds = [...last.viewIds];
      for (const viewId of extra) {
        if (!viewIds.includes(viewId)) viewIds.push(viewId);
      }
      nextGroups[last.groupId] = { ...last, viewIds, activeViewId: last.activeViewId ?? viewIds[0] ?? null };
    }
  } else {
    for (const group of groupsInOrder) {
      nextIds.push(group.groupId);
      nextGroups[group.groupId] = { ...group };
    }
    while (nextIds.length < targetCount) {
      const groupId = createId('group');
      nextIds.push(groupId);
      nextGroups[groupId] = { groupId, viewIds: [], activeViewId: null };
    }
  }

  const stage = buildTemplateStage(nextIds, template, createId);
  const keep = new Set([...nextIds, ...state.rightPanel.groupIds]);
  let next: WorkspaceState = {
    ...state,
    stage,
    groups: { ...state.groups, ...nextGroups },
    displayMode: 'normal',
    maximizedGroupId: null,
  };
  next = removeUnusedStageGroups(next, keep);
  const active = nextIds.includes(state.activeGroupId) ? state.activeGroupId : nextIds[0];
  return { ...next, activeGroupId: active ?? next.activeGroupId };
}

export function setSplitRatio(state: WorkspaceState, splitId: string, ratio: number): WorkspaceState {
  const stage = setSplitRatioOnStage(state.stage, splitId, clampSplitWeight(ratio));
  return stage === state.stage ? state : { ...state, stage };
}

export function swapGroups(state: WorkspaceState, groupIdA: string, groupIdB: string): WorkspaceOpResult {
  if (groupIdA === groupIdB) return okOp(state);
  const a = getGroup(state, groupIdA);
  const b = getGroup(state, groupIdB);
  if (!a || !b) return rejectOp(state, 'missing-target', DOCKING_COPY.illegal);
  const aOnStage = isStageGroupId(state, groupIdA);
  const bOnStage = isStageGroupId(state, groupIdB);
  if (aOnStage !== bOnStage) {
    const views = [...a.viewIds, ...b.viewIds].map((id) => state.views[id]);
    const blocked = views.some((view) => {
      if (!view) return true;
      if (view.kind === 'session') return true;
      return !isMovableToolKind(view.kind);
    });
    if (blocked) return rejectOp(state, 'tool-not-movable', DOCKING_COPY.toolNotMovable);
  }
  return okOp({
    ...state,
    groups: {
      ...state.groups,
      [groupIdA]: { ...a, viewIds: b.viewIds, activeViewId: b.activeViewId },
      [groupIdB]: { ...b, viewIds: a.viewIds, activeViewId: a.activeViewId },
    },
  });
}

export function restoreDefaultLayout(state: WorkspaceState, createId: WorkspaceIdFactory): WorkspaceState {
  const sessionViews = collectStageViewsInOrder(state);
  let next = applyWorkspaceTemplate(state, 'single', createId);
  const stageId = listStageGroupIds(next.stage)[0];
  const rightId = firstRightGroupId(next);
  if (stageId) {
    const unique = [...new Set(sessionViews)];
    next = putGroup(next, {
      groupId: stageId,
      viewIds: unique,
      activeViewId: unique[0] ?? null,
    });
  }
  if (rightId) {
    const toolIds = Object.values(next.views)
      .filter((view) => isMovableToolKind(view.kind))
      .map((view) => view.viewId);
    next = putGroup(next, {
      groupId: rightId,
      viewIds: toolIds,
      activeViewId: toolIds[0] ?? null,
    });
  }
  return { ...next, displayMode: 'normal', maximizedGroupId: null };
}

