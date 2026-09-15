import { DOCKING_COPY } from './copy.js';
import { stageMinSize } from './geometry.js';
import type { WorkspaceIdFactory } from './ids.js';
import { firstRightGroupId, isRightGroupId, isStageGroupId, listStageGroupIds } from './topology.js';
import type { DropDecision, DropSource, DropZone, Size, WorkspaceState } from './types.js';
import { isMovableToolKind } from './types.js';
import { moveViewToEdge, moveViewToGroup, splitGroupAtEdge } from './layout-commands.js';
import { openSessionView } from './view-commands.js';

const EDGE_LABEL = {
  left: DOCKING_COPY.splitLeft,
  right: DOCKING_COPY.splitRight,
  up: DOCKING_COPY.splitUp,
  down: DOCKING_COPY.splitDown,
} as const;

export type DropContext = {
  createId: WorkspaceIdFactory;
  activeProjectScopeKey?: string;
  stageSize?: Size;
};

function fail(code: Extract<DropDecision, { ok: false }>['code'], message: string): DropDecision {
  return { ok: false, code, message };
}

function assertSameProject(source: DropSource, activeProjectScopeKey?: string): DropDecision | null {
  if (!source.projectScopeKey || !activeProjectScopeKey) return null;
  if (source.projectScopeKey === activeProjectScopeKey) return null;
  return fail('cross-project', DOCKING_COPY.crossProject);
}

function fitsStage(state: WorkspaceState, stageSize?: Size): boolean {
  if (!stageSize) return true;
  const min = stageMinSize(state);
  return stageSize.width >= min.width && stageSize.height >= min.height;
}

function rightTarget(state: WorkspaceState): string | null {
  return firstRightGroupId(state);
}

function proposeUnopenedSession(
  state: WorkspaceState,
  sessionId: string,
  zone: DropZone,
  context: DropContext,
): DropDecision {
  if (zone.kind === 'right-center' || zone.kind === 'right-tab' || zone.kind === 'right-dock-band' || zone.kind === 'right-edge') {
    return fail('session-not-in-right-panel', DOCKING_COPY.sessionNotInRight);
  }
  if (zone.kind === 'empty-stage' || zone.kind === 'group-center' || zone.kind === 'group-tab') {
    const groupId =
      zone.kind === 'empty-stage'
        ? listStageGroupIds(state.stage)[0]
        : zone.groupId;
    if (!groupId || isRightGroupId(state, groupId)) {
      return fail('session-not-in-right-panel', DOCKING_COPY.sessionNotInRight);
    }
    const opened = openSessionView(state, sessionId, context.createId, groupId);
    if (!opened.ok) return fail(opened.code, opened.message);
    return { ok: true, state: opened.state, label: DOCKING_COPY.joinGroup };
  }
  if (zone.kind === 'group-edge') {
    if (!isStageGroupId(state, zone.groupId)) {
      return fail('illegal-topology', DOCKING_COPY.illegal);
    }
    const split = splitGroupAtEdge(state, zone.groupId, zone.edge, context.createId);
    if (!split.ok) return fail(split.code, split.message);
    const opened = openSessionView(split.state, sessionId, context.createId, split.state.activeGroupId);
    if (!opened.ok) return fail(opened.code, opened.message);
    if (!fitsStage(opened.state, context.stageSize)) {
      return fail('insufficient-space', DOCKING_COPY.noSpace);
    }
    return { ok: true, state: opened.state, label: EDGE_LABEL[zone.edge] };
  }
  return fail('illegal-topology', DOCKING_COPY.illegal);
}

function proposeExistingView(
  state: WorkspaceState,
  viewId: string,
  zone: DropZone,
  context: DropContext,
): DropDecision {
  const view = state.views[viewId];
  if (!view) return fail('missing-target', DOCKING_COPY.illegal);

  if (zone.kind === 'right-edge') {
    return fail('no-op', DOCKING_COPY.illegal);
  }

  if (view.kind !== 'session' && !isMovableToolKind(view.kind)) {
    if (
      zone.kind === 'group-center' ||
      zone.kind === 'group-tab' ||
      zone.kind === 'group-edge' ||
      zone.kind === 'empty-stage'
    ) {
      return fail('tool-not-movable', DOCKING_COPY.toolNotMovable);
    }
  }

  if (zone.kind === 'right-center' || zone.kind === 'right-tab' || zone.kind === 'right-dock-band') {
    if (view.kind === 'session') {
      return fail('session-not-in-right-panel', DOCKING_COPY.sessionNotInRight);
    }
    const rightId = rightTarget(state);
    if (!rightId) return fail('missing-target', DOCKING_COPY.illegal);
    const moved = moveViewToGroup(state, viewId, rightId, zone.kind === 'right-tab' ? zone.index : undefined);
    if (!moved.ok) return fail(moved.code, moved.message);
    const next =
      zone.kind === 'right-dock-band'
        ? { ...moved.state, rightPanel: { ...moved.state.rightPanel, collapsed: false } }
        : moved.state;
    return { ok: true, state: next, label: DOCKING_COPY.dockRight };
  }

  if (zone.kind === 'empty-stage') {
    const groupId = listStageGroupIds(state.stage)[0];
    if (!groupId) return fail('missing-target', DOCKING_COPY.illegal);
    const moved = moveViewToGroup(state, viewId, groupId);
    if (!moved.ok) return fail(moved.code, moved.message);
    return { ok: true, state: moved.state, label: DOCKING_COPY.joinGroup };
  }

  if (zone.kind === 'group-center' || zone.kind === 'group-tab') {
    if (isRightGroupId(state, zone.groupId)) {
      return proposeExistingView(state, viewId, { kind: 'right-center' }, context);
    }
    const currentGroup = Object.values(state.groups).find((group) => group.viewIds.includes(viewId));
    if (currentGroup?.groupId === zone.groupId && zone.kind === 'group-center') {
      return fail('no-op', '');
    }
    const moved = moveViewToGroup(
      state,
      viewId,
      zone.groupId,
      zone.kind === 'group-tab' ? zone.index : undefined,
    );
    if (!moved.ok) return fail(moved.code, moved.message);
    return { ok: true, state: moved.state, label: DOCKING_COPY.joinGroup };
  }

  if (zone.kind === 'group-edge') {
    if (!isStageGroupId(state, zone.groupId)) {
      return fail('illegal-topology', DOCKING_COPY.illegal);
    }
    const moved = moveViewToEdge(state, viewId, zone.groupId, zone.edge, context.createId);
    if (!moved.ok) return fail(moved.code, moved.message);
    if (!fitsStage(moved.state, context.stageSize)) {
      return fail('insufficient-space', DOCKING_COPY.noSpace);
    }
    return { ok: true, state: moved.state, label: EDGE_LABEL[zone.edge] };
  }

  return fail('illegal-topology', DOCKING_COPY.illegal);
}

export function proposeDrop(
  state: WorkspaceState,
  source: DropSource,
  zone: DropZone,
  context: DropContext,
): DropDecision {
  const cross = assertSameProject(source, context.activeProjectScopeKey);
  if (cross) return cross;
  if (source.kind === 'unopened-session') {
    return proposeUnopenedSession(state, source.sessionId, zone, context);
  }
  return proposeExistingView(state, source.viewId, zone, context);
}

export function splitPreviewLabel(edge: keyof typeof EDGE_LABEL): string {
  return EDGE_LABEL[edge];
}
