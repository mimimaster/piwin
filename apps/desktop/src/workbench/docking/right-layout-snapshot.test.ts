import { describe, expect, it } from 'vitest';
import { createSequentialIdFactory } from './ids.js';
import {
  captureRightLayout,
  parseRightLayoutSnapshot,
  restoreRightLayout,
} from './right-layout-snapshot.js';
import { firstRightGroupId, listStageGroupIds } from './topology.js';
import type { WorkspaceState } from './types.js';
import { createWorkspaceState, insertView, openSessionView, openToolView } from './view-commands.js';

function withTools(kinds: Array<'browser' | 'changes' | 'canvas' | 'doc'>): {
  state: WorkspaceState;
  createId: ReturnType<typeof createSequentialIdFactory>;
} {
  const createId = createSequentialIdFactory();
  let state = createWorkspaceState(createId);
  const session = openSessionView(state, 'session-a', createId);
  state = session.state;
  for (const kind of kinds) state = openToolView(state, kind, createId).state;
  return { state, createId };
}

function rightKinds(state: WorkspaceState): string[] {
  const groupId = firstRightGroupId(state);
  const group = groupId ? state.groups[groupId] : undefined;
  return (group?.viewIds ?? []).map((viewId) => state.views[viewId]?.kind ?? 'missing');
}

describe('right layout snapshot', () => {
  it('captures the right group tools in order with the front one', () => {
    const { state } = withTools(['changes', 'browser']);
    expect(captureRightLayout(state)).toEqual({
      views: [{ kind: 'changes' }, { kind: 'browser' }],
      activeKind: 'browser',
    });
  });

  it('restores another session layout and drops tools it did not have', () => {
    const { state, createId } = withTools(['changes', 'browser']);
    const next = restoreRightLayout(
      state,
      { views: [{ kind: 'doc', title: 'index.html' }], activeKind: 'doc' },
      createId,
    );
    expect(rightKinds(next)).toEqual(['doc']);
    expect(Object.values(next.views).some((view) => view.kind === 'browser')).toBe(false);
    // The session view on the stage is untouched.
    expect(Object.values(next.views).some((view) => view.sessionId === 'session-a')).toBe(true);
  });

  it('keeps the view of a tool both layouts share, so the browser does not remount', () => {
    const { state, createId } = withTools(['changes', 'browser']);
    const browserId = Object.values(state.views).find((view) => view.kind === 'browser')?.viewId;
    const next = restoreRightLayout(
      state,
      { views: [{ kind: 'browser' }, { kind: 'canvas' }], activeKind: 'canvas' },
      createId,
    );
    expect(rightKinds(next)).toEqual(['browser', 'canvas']);
    expect(Object.values(next.views).find((view) => view.kind === 'browser')?.viewId).toBe(browserId);
    const groupId = firstRightGroupId(next);
    const active = groupId ? next.groups[groupId]?.activeViewId : null;
    expect(active ? next.views[active]?.kind : null).toBe('canvas');
  });

  it('never duplicates a tool that sits on the stage', () => {
    const { state: base, createId } = withTools([]);
    const stageGroupId = listStageGroupIds(base.stage)[0] ?? '';
    const state = insertView(base, stageGroupId, { viewId: 'stage-browser', kind: 'browser' });
    const next = restoreRightLayout(state, { views: [{ kind: 'browser' }], activeKind: 'browser' }, createId);
    expect(rightKinds(next)).toEqual([]);
    expect(Object.values(next.views).filter((view) => view.kind === 'browser')).toHaveLength(1);
  });

  it('moves focus back to the session when the focused tool goes away', () => {
    const { state, createId } = withTools(['browser']);
    const next = restoreRightLayout(state, { views: [], activeKind: null }, createId);
    const focused = next.focusedViewId ? next.views[next.focusedViewId] : undefined;
    expect(focused?.sessionId).toBe('session-a');
  });

  it('parses stored snapshots defensively', () => {
    expect(parseRightLayoutSnapshot('nope')).toBeNull();
    expect(
      parseRightLayoutSnapshot({ views: [{ kind: 'browser' }, { kind: 'session' }, 3], activeKind: 'x' }),
    ).toEqual({ views: [{ kind: 'browser' }], activeKind: null });
  });
});
