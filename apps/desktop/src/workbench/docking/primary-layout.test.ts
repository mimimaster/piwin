import { describe, expect, it } from 'vitest';
import { createSequentialIdFactory } from './ids.js';
import { createWorkspaceState, insertView, openSessionView, openToolView, splitGroupAtEdge } from './commands.js';
import {
  isPrimaryDockingLayout,
  primaryLayoutSessionId,
  syncPrimarySessionView,
} from './primary-layout.js';
import type { WorkspaceState } from './types.js';

function setup() {
  const createId = createSequentialIdFactory();
  return { createId, state: createWorkspaceState(createId) };
}

function stageViewIds(state: ReturnType<typeof createWorkspaceState>): string[] {
  if (state.stage.kind !== 'group') throw new Error('expected a single stage group');
  return state.groups[state.stage.groupId]?.viewIds ?? [];
}

function stackSessionTab(state: WorkspaceState, sessionId: string, createId: ReturnType<typeof createSequentialIdFactory>): WorkspaceState {
  if (state.stage.kind !== 'group') throw new Error('expected a single stage group');
  const viewId = createId('view');
  return insertView(state, state.stage.groupId, { viewId, kind: 'session', sessionId });
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

  it('stays on the primary chat when a second session is opened in the same group', () => {
    const { createId, state } = setup();
    const first = openSessionView(state, 's1', createId);
    if (!first.ok) throw new Error(first.message);
    const second = openSessionView(first.state, 's2', createId);
    if (!second.ok) throw new Error(second.message);
    expect(stageViewIds(second.state)).toHaveLength(1);
    expect(isPrimaryDockingLayout(second.state)).toBe(true);
    expect(primaryLayoutSessionId(second.state)).toBe('s2');
    const split = splitGroupAtEdge(first.state, first.state.activeGroupId, 'right', createId);
    if (!split.ok) throw new Error(split.message);
    expect(isPrimaryDockingLayout(split.state)).toBe(false);
    const stageTool = openToolView(first.state, 'changes', createId, first.state.activeGroupId);
    if (!stageTool.ok) throw new Error(stageTool.message);
    expect(isPrimaryDockingLayout(stageTool.state)).toBe(false);
  });

  it('rebinds the lone view and collapses leftover session tabs', () => {
    const { createId, state } = setup();
    const first = openSessionView(state, 's1', createId);
    if (!first.ok) throw new Error(first.message);
    const rebound = syncPrimarySessionView(first.state, 's2', createId);
    expect(primaryLayoutSessionId(rebound)).toBe('s2');
    expect(Object.values(rebound.views).map((view) => view.sessionId)).toEqual(['s2']);
    expect(rebound.sessionTargetId).toBe('s2');
    // Same view id: the surface host is reused, so the chat column never remounts.
    expect(Object.keys(rebound.views)).toEqual(Object.keys(first.state.views));

    const second = stackSessionTab(first.state, 's2', createId);
    const collapsed = syncPrimarySessionView(second, 's1', createId);
    expect(isPrimaryDockingLayout(collapsed)).toBe(true);
    expect(primaryLayoutSessionId(collapsed)).toBe('s1');
    expect(stageViewIds(collapsed)).toHaveLength(1);
    expect(Object.values(collapsed.views).map((view) => view.sessionId)).toEqual(['s1']);
  });

  it('keeps the matching session view when collapsing leftover tabs', () => {
    const { createId, state } = setup();
    const first = openSessionView(state, 's1', createId);
    if (!first.ok) throw new Error(first.message);
    const second = stackSessionTab(first.state, 's2', createId);
    const third = stackSessionTab(second, 's3', createId);
    const keepId = Object.values(third.views).find((view) => view.sessionId === 's2')?.viewId;
    if (keepId === undefined) throw new Error('expected s2 view');
    const collapsed = syncPrimarySessionView(third, 's2', createId);
    expect(isPrimaryDockingLayout(collapsed)).toBe(true);
    expect(primaryLayoutSessionId(collapsed)).toBe('s2');
    expect(stageViewIds(collapsed)).toEqual([keepId]);
    expect(collapsed.reopenStack).toEqual(third.reopenStack);
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
