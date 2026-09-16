import { describe, expect, it } from 'vitest';
import { createSequentialIdFactory } from './ids.js';
import { createWorkspaceState, openSessionView, openToolView, splitGroupAtEdge } from './commands.js';
import {
  isPrimaryDockingLayout,
  primaryLayoutSessionId,
  syncPrimarySessionView,
} from './primary-layout.js';

function setup() {
  const createId = createSequentialIdFactory();
  return { createId, state: createWorkspaceState(createId) };
}

function stageViewIds(state: ReturnType<typeof createWorkspaceState>): string[] {
  if (state.stage.kind !== 'group') throw new Error('expected a single stage group');
  return state.groups[state.stage.groupId]?.viewIds ?? [];
}

describe('docking primary layout', () => {
  it('treats an empty or single-session stage as the primary chat', () => {
    const { createId, state } = setup();
    expect(isPrimaryDockingLayout(state)).toBe(true);
    const opened = openSessionView(state, 's1', createId);
    if (!opened.ok) throw new Error(opened.message);
    expect(isPrimaryDockingLayout(opened.state)).toBe(true);
    expect(primaryLayoutSessionId(opened.state)).toBe('s1');
  });

  it('keeps the primary chat when tools dock in the right panel', () => {
    const { createId, state } = setup();
    const browser = openToolView(state, 'browser', createId);
    if (!browser.ok) throw new Error(browser.message);
    expect(isPrimaryDockingLayout(browser.state)).toBe(true);
  });

  it('leaves the primary chat once a second session tab opens', () => {
    const { createId, state } = setup();
    const first = openSessionView(state, 's1', createId);
    if (!first.ok) throw new Error(first.message);
    const second = openSessionView(first.state, 's2', createId);
    if (!second.ok) throw new Error(second.message);
    expect(stageViewIds(second.state)).toHaveLength(2);
    expect(isPrimaryDockingLayout(second.state)).toBe(false);
    const split = splitGroupAtEdge(first.state, first.state.activeGroupId, 'right', createId);
    if (!split.ok) throw new Error(split.message);
    expect(isPrimaryDockingLayout(split.state)).toBe(false);
    const stageTool = openToolView(first.state, 'changes', createId, first.state.activeGroupId);
    if (!stageTool.ok) throw new Error(stageTool.message);
    expect(isPrimaryDockingLayout(stageTool.state)).toBe(false);
  });

  it('rebinds the lone view and leaves a tab strip alone', () => {
    const { createId, state } = setup();
    const first = openSessionView(state, 's1', createId);
    if (!first.ok) throw new Error(first.message);
    const rebound = syncPrimarySessionView(first.state, 's2', createId);
    expect(primaryLayoutSessionId(rebound)).toBe('s2');
    expect(Object.values(rebound.views).map((view) => view.sessionId)).toEqual(['s2']);
    expect(rebound.sessionTargetId).toBe('s2');
    // Same view id: the surface host is reused, so the chat column never remounts.
    expect(Object.keys(rebound.views)).toEqual(Object.keys(first.state.views));

    const second = openSessionView(first.state, 's2', createId);
    if (!second.ok) throw new Error(second.message);
    expect(syncPrimarySessionView(second.state, 's1', createId)).toBe(second.state);
  });

  it('follows the workbench session without stacking tabs', () => {
    const { createId, state } = setup();
    const withS1 = syncPrimarySessionView(state, 's1', createId);
    expect(primaryLayoutSessionId(withS1)).toBe('s1');
    const withS2 = syncPrimarySessionView(withS1, 's2', createId);
    expect(primaryLayoutSessionId(withS2)).toBe('s2');
    expect(Object.keys(withS2.views)).toHaveLength(1);
    expect(withS2.sessionTargetId).toBe('s2');
    expect(syncPrimarySessionView(withS2, 's2', createId)).toBe(withS2);
    const cleared = syncPrimarySessionView(withS2, null, createId);
    expect(primaryLayoutSessionId(cleared)).toBeNull();
    expect(cleared.reopenStack).toEqual(withS2.reopenStack);
  });

  it('does not touch a real split', () => {
    const { createId, state } = setup();
    const opened = openSessionView(state, 's1', createId);
    if (!opened.ok) throw new Error(opened.message);
    const split = splitGroupAtEdge(opened.state, opened.state.activeGroupId, 'right', createId);
    if (!split.ok) throw new Error(split.message);
    expect(syncPrimarySessionView(split.state, 's9', createId)).toBe(split.state);
  });
});
