import { listConversationPaneLeaves, type ConversationPaneLayout, type ConversationPaneNode } from '../../conversation-pane-layout.js';
import { DOCKING_COPY } from './copy.js';
import type { WorkspaceIdFactory } from './ids.js';
import { applyWorkspaceTemplate } from './layout-commands.js';
import { isLegalStageTopology, listStageGroupIds, stageDepth } from './topology.js';
import type { StageNode, WorkspaceGroup, WorkspaceState, WorkspaceView } from './types.js';
import { createWorkspaceState, insertView } from './view-commands.js';

export type WorkspaceMigrationResult = {
  state: WorkspaceState;
  migrated: boolean;
  notice: string | null;
};

function convertNode(
  node: ConversationPaneNode,
  createId: WorkspaceIdFactory,
  groups: Record<string, WorkspaceGroup>,
  views: Record<string, WorkspaceView>,
  paneToGroup: Map<string, string>,
): StageNode {
  if (node.kind === 'leaf') {
    const groupId = createId('group');
    paneToGroup.set(node.paneId, groupId);
    const viewIds: string[] = [];
    let activeViewId: string | null = null;
    if (node.sessionId) {
      const viewId = createId('view');
      views[viewId] = { viewId, kind: 'session', sessionId: node.sessionId };
      viewIds.push(viewId);
      activeViewId = viewId;
    }
    groups[groupId] = { groupId, viewIds, activeViewId };
    return { kind: 'group', groupId };
  }
  return {
    kind: 'split',
    splitId: createId('split'),
    orientation: node.orientation,
    ratio: node.ratio,
    first: convertNode(node.first, createId, groups, views, paneToGroup),
    second: convertNode(node.second, createId, groups, views, paneToGroup),
  };
}

function attachConverted(
  empty: WorkspaceState,
  stage: StageNode,
  groups: Record<string, WorkspaceGroup>,
  views: Record<string, WorkspaceView>,
  activeGroupId: string,
  sessionTargetId: string | null,
): WorkspaceState {
  return {
    ...empty,
    stage,
    groups: { ...empty.groups, ...groups },
    views: { ...empty.views, ...views },
    activeGroupId,
    sessionTargetId,
    focusedViewId: sessionTargetId
      ? Object.values(views).find((view) => view.sessionId === sessionTargetId)?.viewId ?? null
      : null,
  };
}

function migrateFiveToEight(
  empty: WorkspaceState,
  layout: ConversationPaneLayout,
  createId: WorkspaceIdFactory,
): WorkspaceMigrationResult {
  const leaves = listConversationPaneLeaves(layout.root);
  const firstThree = leaves.slice(0, 3);
  const rest = leaves.slice(3);
  let state = applyWorkspaceTemplate(empty, 'quad', createId);
  const groupIds = listStageGroupIds(state.stage);
  const slots = [
    firstThree[0] ? [firstThree[0]] : [],
    firstThree[1] ? [firstThree[1]] : [],
    firstThree[2] ? [firstThree[2]] : [],
    rest,
  ];
  for (let index = 0; index < 4; index += 1) {
    const groupId = groupIds[index];
    const slot = slots[index];
    if (!groupId || !slot) continue;
    for (const leaf of slot) {
      if (!leaf.sessionId) continue;
      const inserted = insertView(state, groupId, {
        viewId: createId('view'),
        kind: 'session',
        sessionId: leaf.sessionId,
      });
      state = inserted;
    }
  }
  const extra = rest.filter((leaf) => leaf.sessionId).length;
  return {
    state,
    migrated: true,
    notice: extra > 0 ? DOCKING_COPY.migrateNotice(extra) : null,
  };
}

export function migrateConversationPaneLayout(
  layout: ConversationPaneLayout,
  createId: WorkspaceIdFactory,
): WorkspaceMigrationResult {
  const empty = createWorkspaceState(createId);
  const leaves = listConversationPaneLeaves(layout.root);
  if (leaves.length > 4) {
    return migrateFiveToEight(empty, layout, createId);
  }

  const groups: Record<string, WorkspaceGroup> = {};
  const views: Record<string, WorkspaceView> = {};
  const paneToGroup = new Map<string, string>();
  const stage = convertNode(layout.root, createId, groups, views, paneToGroup);
  if (isLegalStageTopology(stage) && stageDepth(stage) <= 2) {
    const activeGroupId =
      paneToGroup.get(layout.activePaneId) ?? listStageGroupIds(stage)[0] ?? empty.activeGroupId;
    const activeLeaf = leaves.find((leaf) => leaf.paneId === layout.activePaneId);
    return {
      state: attachConverted(empty, stage, groups, views, activeGroupId, activeLeaf?.sessionId ?? null),
      migrated: true,
      notice: null,
    };
  }

  let state = empty;
  if (leaves.length === 2) state = applyWorkspaceTemplate(state, 'columns', createId);
  else if (leaves.length >= 3) state = applyWorkspaceTemplate(state, leaves.length === 3 ? 'columns' : 'quad', createId);
  const groupIds = listStageGroupIds(state.stage);
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index];
    const groupId = groupIds[Math.min(index, groupIds.length - 1)];
    if (!leaf?.sessionId || !groupId) continue;
    state = insertView(state, groupId, {
      viewId: createId('view'),
      kind: 'session',
      sessionId: leaf.sessionId,
    });
  }
  return { state, migrated: true, notice: null };
}

export function migrateDamagedLayout(raw: unknown, createId: WorkspaceIdFactory): WorkspaceMigrationResult {
  const sessionIds: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.sessionId === 'string' && record.sessionId.trim() && !seen.has(record.sessionId)) {
      seen.add(record.sessionId);
      sessionIds.push(record.sessionId);
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(raw);
  let state = createWorkspaceState(createId);
  const groupId = listStageGroupIds(state.stage)[0];
  if (groupId) {
    for (const sessionId of sessionIds) {
      state = insertView(state, groupId, {
        viewId: createId('view'),
        kind: 'session',
        sessionId,
      });
    }
  }
  return { state, migrated: true, notice: null };
}
