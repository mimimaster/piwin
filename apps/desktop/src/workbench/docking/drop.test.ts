import { describe, expect, it } from 'vitest';
import { DOCKING_COPY } from './copy.js';
import { proposeDrop } from './drop.js';
import { createSequentialIdFactory } from './ids.js';
import { applyWorkspaceTemplate, openSessionView, openToolView, splitGroupAtEdge } from './commands.js';
import { createWorkspaceState } from './view-commands.js';
import { listStageGroupIds, stageGroupCount } from './topology.js';

describe('docking drop matrix', () => {
  it('rejects dropping a session onto the right panel', () => {
    const createId = createSequentialIdFactory();
    const opened = openSessionView(createWorkspaceState(createId), 's1', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const viewId = opened.state.focusedViewId;
    if (!viewId) throw new Error('missing view');
    const decision = proposeDrop(
      opened.state,
      { kind: 'view', viewId },
      { kind: 'right-center' },
      { createId },
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe('session-not-in-right-panel');
    expect(decision.message).toBe(DOCKING_COPY.sessionNotInRight);
  });

  it('rejects unopened sessions onto the right panel with the same copy', () => {
    const createId = createSequentialIdFactory();
    const state = createWorkspaceState(createId);
    const decision = proposeDrop(
      state,
      { kind: 'unopened-session', sessionId: 's9' },
      { kind: 'right-dock-band' },
      { createId },
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.message).toBe(DOCKING_COPY.sessionNotInRight);
  });

  it('allows moving a last view off a fourth group without a false four-cap reject', () => {
    const createId = createSequentialIdFactory();
    let state = applyWorkspaceTemplate(createWorkspaceState(createId), 'quad', createId);
    const groups = listStageGroupIds(state.stage);
    expect(groups).toHaveLength(4);
    for (let index = 0; index < 4; index += 1) {
      const groupId = groups[index];
      if (!groupId) continue;
      const opened = openSessionView(state, `s${String(index)}`, createId, groupId);
      expect(opened.ok).toBe(true);
      if (opened.ok) state = opened.state;
    }
    const moving = Object.values(state.views).find((view) => view.sessionId === 's0');
    const target = groups[1];
    if (!moving || !target) throw new Error('missing');
    const decision = proposeDrop(
      state,
      { kind: 'view', viewId: moving.viewId },
      { kind: 'group-edge', groupId: target, edge: 'right' },
      { createId },
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(stageGroupCount(decision.state.stage)).toBe(4);
  });

  it('rejects cross-project drops', () => {
    const createId = createSequentialIdFactory();
    const state = createWorkspaceState(createId);
    const decision = proposeDrop(
      state,
      { kind: 'unopened-session', sessionId: 'other', projectScopeKey: 'proj-b' },
      { kind: 'empty-stage' },
      { createId, activeProjectScopeKey: 'proj-a' },
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe('cross-project');
    expect(decision.message).toBe(DOCKING_COPY.crossProject);
  });

  it('docks a browser to the right panel and refuses cloning', () => {
    const createId = createSequentialIdFactory();
    const opened = openToolView(createWorkspaceState(createId), 'browser', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const viewId = opened.state.focusedViewId;
    const stageId = listStageGroupIds(opened.state.stage)[0];
    if (!viewId || !stageId) throw new Error('missing');
    const toStage = proposeDrop(
      opened.state,
      { kind: 'view', viewId },
      { kind: 'group-center', groupId: stageId },
      { createId },
    );
    expect(toStage.ok).toBe(true);
    if (!toStage.ok) return;
    const back = proposeDrop(
      toStage.state,
      { kind: 'view', viewId },
      { kind: 'right-center' },
      { createId },
    );
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(Object.values(back.state.views).filter((view) => view.kind === 'browser')).toHaveLength(1);
  });

  it('no-ops dropping the only tab onto its own edge', () => {
    const createId = createSequentialIdFactory();
    const opened = openSessionView(createWorkspaceState(createId), 'only', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const viewId = opened.state.focusedViewId;
    const groupId = listStageGroupIds(opened.state.stage)[0];
    if (!viewId || !groupId) throw new Error('missing');
    const decision = proposeDrop(
      opened.state,
      { kind: 'view', viewId },
      { kind: 'group-edge', groupId, edge: 'right' },
      { createId },
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe('no-op');
  });

  it('blocks a third-level split with illegal topology copy', () => {
    const createId = createSequentialIdFactory();
    let state = createWorkspaceState(createId);
    const g0 = listStageGroupIds(state.stage)[0];
    if (!g0) throw new Error('missing');
    const col = splitGroupAtEdge(state, g0, 'right', createId);
    expect(col.ok).toBe(true);
    if (!col.ok) return;
    state = col.state;
    const right = listStageGroupIds(state.stage)[1];
    if (!right) throw new Error('missing right');
    const stacked = splitGroupAtEdge(state, right, 'down', createId);
    expect(stacked.ok).toBe(true);
    if (!stacked.ok) return;
    state = stacked.state;
    const small = listStageGroupIds(state.stage)[1];
    if (!small) throw new Error('missing small');
    const third = splitGroupAtEdge(state, small, 'right', createId);
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.message).toBe(DOCKING_COPY.illegal);
  });
});
