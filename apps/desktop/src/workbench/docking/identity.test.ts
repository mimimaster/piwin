import { describe, expect, it } from 'vitest';
import { closeView, createWorkspaceState, openSessionView, openToolView } from './commands.js';
import { focusView, maximizeGroup } from './identity.js';
import { createSequentialIdFactory } from './ids.js';
import { selectLiveSessionIds } from './live-budget.js';
import { listStageGroupIds } from './topology.js';

describe('docking identity and live budget', () => {
  it('keeps session target when focusing a tool view', () => {
    const createId = createSequentialIdFactory();
    const session = openSessionView(createWorkspaceState(createId), 'target', createId);
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const tool = openToolView(session.state, 'changes', createId);
    expect(tool.ok).toBe(true);
    if (!tool.ok) return;
    expect(tool.state.sessionTargetId).toBe('target');
    const toolViewId = tool.state.focusedViewId;
    if (!toolViewId) throw new Error('missing tool');
    const focused = focusView(tool.state, toolViewId);
    expect(focused.sessionTargetId).toBe('target');
  });

  it('does not retarget send after the session target view is closed', () => {
    const createId = createSequentialIdFactory();
    const first = openSessionView(createWorkspaceState(createId), 'a', createId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const viewA = Object.values(first.state.views).find((view) => view.sessionId === 'a');
    if (!viewA) throw new Error('missing a');
    const closed = closeView(first.state, viewA.viewId);
    expect(closed.sessionTargetId).toBeNull();
  });

  it('moves maximize to the newly focused group', () => {
    const createId = createSequentialIdFactory();
    const opened = openSessionView(createWorkspaceState(createId), 'a', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const groupId = listStageGroupIds(opened.state.stage)[0];
    if (!groupId) throw new Error('missing group');
    const maxed = maximizeGroup(opened.state, groupId);
    expect(maxed.displayMode).toBe('maximized');
    expect(maxed.maximizedGroupId).toBe(groupId);
  });

  it('caps live subscriptions at 8 preferring visible stage sessions', () => {
    const createId = createSequentialIdFactory();
    const opened = openSessionView(createWorkspaceState(createId), 'visible', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const hidden = Array.from({ length: 12 }, (_, index) => `hidden-${String(index)}`);
    const selected = selectLiveSessionIds(opened.state, hidden);
    expect(selected[0]).toBe('visible');
    expect(selected).toHaveLength(8);
  });
});
