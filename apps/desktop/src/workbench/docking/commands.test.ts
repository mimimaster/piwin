import { describe, expect, it } from 'vitest';
import { createSequentialIdFactory } from './ids.js';
import {
  applyWorkspaceTemplate,
  closeView,
  createWorkspaceState,
  moveViewToEdge,
  openSessionView,
  openToolView,
  reopenLastView,
  setSplitRatio,
  splitGroupAtEdge,
} from './commands.js';
import { STAGE_GROUP_HARD_LIMIT } from './constants.js';
import { isLegalStageTopology, listStageGroupIds, stageGroupCount, stageDepth } from './topology.js';

function setup() {
  const createId = createSequentialIdFactory();
  return { createId, state: createWorkspaceState(createId) };
}

describe('docking workspace commands', () => {
  it('opens a session without duplicating the same session view', () => {
    const { createId, state } = setup();
    const first = openSessionView(state, 's1', createId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = openSessionView(first.state, 's1', createId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(Object.values(second.state.views).filter((view) => view.sessionId === 's1')).toHaveLength(1);
    expect(second.state.sessionTargetId).toBe('s1');
  });

  it('rebinds the group session instead of stacking a second tab', () => {
    const { createId, state } = setup();
    const first = openSessionView(state, 's1', createId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const viewId = first.state.focusedViewId;
    const second = openSessionView(first.state, 's2', createId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(Object.keys(second.state.views)).toHaveLength(1);
    expect(second.state.focusedViewId).toBe(viewId);
    expect(second.state.sessionTargetId).toBe('s2');
  });

  it('hard-caps stage groups at four and keeps two-level topology', () => {
    const { createId } = setup();
    let state = createWorkspaceState(createId);
    const opened = openSessionView(state, 's1', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    state = opened.state;
    const g0 = listStageGroupIds(state.stage)[0];
    if (!g0) throw new Error('missing group');
    for (const edge of ['right', 'down', 'left'] as const) {
      const split = splitGroupAtEdge(state, listStageGroupIds(state.stage)[0] ?? g0, edge, createId);
      if (split.ok) state = split.state;
    }
    expect(stageGroupCount(state.stage)).toBeLessThanOrEqual(STAGE_GROUP_HARD_LIMIT);
    const last = listStageGroupIds(state.stage)[0];
    if (!last) throw new Error('missing group');
    const blocked = splitGroupAtEdge(state, last, 'right', createId);
    if (stageGroupCount(state.stage) >= STAGE_GROUP_HARD_LIMIT) {
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.code).toBe('stage-group-limit');
    }
    expect(isLegalStageTopology(state.stage)).toBe(true);
    expect(stageDepth(state.stage)).toBeLessThanOrEqual(2);
  });

  it('collapses an emptied stage group after moving the last view', () => {
    const { createId } = setup();
    let state = createWorkspaceState(createId);
    const a = openSessionView(state, 'a', createId);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    state = a.state;
    const groupId = listStageGroupIds(state.stage)[0];
    if (!groupId) throw new Error('missing group');
    const split = splitGroupAtEdge(state, groupId, 'right', createId);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    state = split.state;
    const b = openSessionView(state, 'b', createId, split.state.activeGroupId);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    state = b.state;
    expect(stageGroupCount(state.stage)).toBe(2);
    const viewA = Object.values(state.views).find((view) => view.sessionId === 'a');
    const rightGroup = listStageGroupIds(state.stage)[1];
    if (!viewA || !rightGroup) throw new Error('missing view');
    const moved = moveViewToEdge(state, viewA.viewId, rightGroup, 'down', createId);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(stageGroupCount(moved.state.stage)).toBe(2);
  });

  it('template shrink concatenates leftover tabs instead of dropping them', () => {
    const { createId } = setup();
    let state = applyWorkspaceTemplate(createWorkspaceState(createId), 'quad', createId);
    const groupIds = listStageGroupIds(state.stage);
    expect(groupIds).toHaveLength(4);
    for (let index = 0; index < 4; index += 1) {
      const groupId = groupIds[index];
      if (!groupId) continue;
      const opened = openSessionView(state, `s${String(index)}`, createId, groupId);
      expect(opened.ok).toBe(true);
      if (opened.ok) state = opened.state;
    }
    state = applyWorkspaceTemplate(state, 'single', createId);
    expect(listStageGroupIds(state.stage)).toHaveLength(1);
    expect(Object.keys(state.views)).toHaveLength(4);
    const sole = listStageGroupIds(state.stage)[0];
    expect(sole ? state.groups[sole]?.viewIds.length : 0).toBe(4);
  });

  it('does not rewrite stored split weights when asked to set them', () => {
    const { createId } = setup();
    let state = applyWorkspaceTemplate(createWorkspaceState(createId), 'columns', createId);
    const splitId = state.stage.kind === 'split' ? state.stage.splitId : null;
    if (!splitId) throw new Error('expected split');
    state = setSplitRatio(state, splitId, 0.7);
    expect(state.stage.kind === 'split' && state.stage.ratio).toBe(0.7);
    state = setSplitRatio(state, splitId, 0.7);
    expect(state.stage.kind === 'split' && state.stage.ratio).toBe(0.7);
  });

  it('reopens a closed session onto the original group when it still exists', () => {
    const { createId } = setup();
    const opened = openSessionView(createWorkspaceState(createId), 'keep', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const groupId = listStageGroupIds(opened.state.stage)[0];
    if (!groupId) throw new Error('missing group');
    const split = splitGroupAtEdge(opened.state, groupId, 'right', createId);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const extra = openSessionView(split.state, 'gone', createId, split.state.activeGroupId);
    expect(extra.ok).toBe(true);
    if (!extra.ok) return;
    const gone = Object.values(extra.state.views).find((view) => view.sessionId === 'gone');
    if (!gone) throw new Error('missing view');
    const closed = closeView(extra.state, gone.viewId);
    expect(closed.reopenStack).toHaveLength(1);
    const reopened = reopenLastView(closed, createId);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(Object.values(reopened.state.views).some((view) => view.sessionId === 'gone')).toBe(true);
  });

  it('keeps one browser view: opening it again focuses the open one', () => {
    const { createId, state } = setup();
    const first = openToolView(state, 'browser', createId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = openToolView(first.state, 'browser', createId);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(Object.values(again.state.views).filter((view) => view.kind === 'browser')).toHaveLength(1);
    expect(again.state.focusedViewId).toBe(first.state.focusedViewId);
  });

  it('focuses the existing canvas when auto-reveal and the launcher both open it', () => {
    const { createId, state } = setup();
    const first = openToolView(state, 'canvas', createId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = openToolView(first.state, 'canvas', createId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(Object.values(second.state.views).filter((view) => view.kind === 'canvas')).toHaveLength(1);
    expect(second.state.focusedViewId).toBe(first.state.focusedViewId);
  });
});
