import { STAGE_GROUP_HARD_LIMIT } from './constants.js';
import type { StageNode, WorkspaceGroup, WorkspaceState, WorkspaceViewKind } from './types.js';

export function listStageGroupIds(node: StageNode): string[] {
  if (node.kind === 'group') return [node.groupId];
  return [...listStageGroupIds(node.first), ...listStageGroupIds(node.second)];
}

export function stageGroupCount(node: StageNode): number {
  return listStageGroupIds(node).length;
}

export function stageDepth(node: StageNode): number {
  if (node.kind === 'group') return 0;
  return 1 + Math.max(stageDepth(node.first), stageDepth(node.second));
}

export function isLegalStageTopology(node: StageNode): boolean {
  return stageGroupCount(node) <= STAGE_GROUP_HARD_LIMIT && stageDepth(node) <= 2;
}

export function isStageGroupId(state: WorkspaceState, groupId: string): boolean {
  return listStageGroupIds(state.stage).includes(groupId);
}

export function isRightGroupId(state: WorkspaceState, groupId: string): boolean {
  return state.rightPanel.groupIds.includes(groupId);
}

export function getGroup(state: WorkspaceState, groupId: string): WorkspaceGroup | undefined {
  return state.groups[groupId];
}

export function findViewGroupId(state: WorkspaceState, viewId: string): string | null {
  for (const group of Object.values(state.groups)) {
    if (group.viewIds.includes(viewId)) return group.groupId;
  }
  return null;
}

export function findSessionViewId(state: WorkspaceState, sessionId: string): string | null {
  for (const view of Object.values(state.views)) {
    if (view.kind === 'session' && view.sessionId === sessionId) return view.viewId;
  }
  return null;
}

export function findToolViewId(state: WorkspaceState, kind: WorkspaceViewKind): string | null {
  for (const view of Object.values(state.views)) {
    if (view.kind === kind) return view.viewId;
  }
  return null;
}

export function countViews(state: WorkspaceState): number {
  return Object.keys(state.views).length;
}

export function countCanvasViews(state: WorkspaceState): number {
  return Object.values(state.views).filter((view) => view.kind === 'canvas').length;
}

export function mapStageNode(
  node: StageNode,
  groupId: string,
  update: (current: StageNode) => StageNode,
): StageNode {
  if (node.kind === 'group') {
    return node.groupId === groupId ? update(node) : node;
  }
  const first = mapStageNode(node.first, groupId, update);
  const second = mapStageNode(node.second, groupId, update);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function removeStageGroup(node: StageNode, groupId: string): StageNode | null {
  if (node.kind === 'group') {
    return node.groupId === groupId ? null : node;
  }
  const first = removeStageGroup(node.first, groupId);
  const second = removeStageGroup(node.second, groupId);
  if (first === null) return second;
  if (second === null) return first;
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

export function findSplit(node: StageNode, splitId: string): Extract<StageNode, { kind: 'split' }> | null {
  if (node.kind === 'group') return null;
  if (node.splitId === splitId) return node;
  return findSplit(node.first, splitId) ?? findSplit(node.second, splitId);
}

export function setSplitRatioOnStage(node: StageNode, splitId: string, ratio: number): StageNode {
  if (node.kind === 'group') return node;
  if (node.splitId === splitId) {
    return node.ratio === ratio ? node : { ...node, ratio };
  }
  const first = setSplitRatioOnStage(node.first, splitId, ratio);
  const second = setSplitRatioOnStage(node.second, splitId, ratio);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function replaceStage(state: WorkspaceState, stage: StageNode): WorkspaceState {
  return stage === state.stage ? state : { ...state, stage };
}

export function putGroup(state: WorkspaceState, group: WorkspaceGroup): WorkspaceState {
  const current = state.groups[group.groupId];
  if (current === group) return state;
  return { ...state, groups: { ...state.groups, [group.groupId]: group } };
}

export function deleteStageGroupRecord(state: WorkspaceState, groupId: string): WorkspaceState {
  if (isRightGroupId(state, groupId)) return state;
  if (!(groupId in state.groups)) return state;
  const { [groupId]: _removed, ...groups } = state.groups;
  void _removed;
  const stageIds = listStageGroupIds(state.stage).filter((id) => id !== groupId);
  const activeGroupId = state.activeGroupId === groupId ? (stageIds[0] ?? state.activeGroupId) : state.activeGroupId;
  return { ...state, groups, activeGroupId };
}

/**
 * Collapse stage groups emptied by close/move. Template-created empty groups
 * must not call this until the user actually emptied them.
 */
export function collapseEmptyStageGroups(state: WorkspaceState): WorkspaceState {
  const emptyIds = listStageGroupIds(state.stage).filter((groupId) => {
    const group = state.groups[groupId];
    return !group || group.viewIds.length === 0;
  });
  if (emptyIds.length === 0) return state;
  let next: WorkspaceState = state;
  for (const groupId of emptyIds) {
    const remaining = listStageGroupIds(next.stage);
    if (remaining.length <= 1) {
      const sole = remaining[0];
      if (sole) {
        const group = next.groups[sole];
        if (group && group.viewIds.length === 0) {
          next = {
            ...next,
            activeGroupId: sole,
            focusedViewId: null,
          };
        }
      }
      continue;
    }
    const stage = removeStageGroup(next.stage, groupId);
    if (stage === null) continue;
    next = deleteStageGroupRecord({ ...next, stage }, groupId);
  }
  return next;
}

export function firstRightGroupId(state: WorkspaceState): string | null {
  return state.rightPanel.groupIds[0] ?? null;
}

export function ensureActiveGroup(state: WorkspaceState): WorkspaceState {
  if (state.groups[state.activeGroupId]) return state;
  const fallback = listStageGroupIds(state.stage)[0];
  if (!fallback) return state;
  return { ...state, activeGroupId: fallback };
}
