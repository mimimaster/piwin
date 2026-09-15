// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyWorkspaceTemplate, createWorkspaceState, openSessionView } from './commands.js';
import { DOCKING_COPY } from './copy.js';
import { collectTabAreas, resolveDockDrag, toLocalPoint } from './docking-drop-resolver.js';
import { createSequentialIdFactory } from './ids.js';
import { listStageGroupIds, stageGroupCount } from './topology.js';
import type { GroupRect, WorkspaceState } from './types.js';

// Wide enough for three 420px-min groups; a narrower stage must reject instead.
const STAGE = { width: 1800, height: 900 };

function rects(groupIds: readonly string[]): GroupRect[] {
  return groupIds.map((groupId, index) => ({
    groupId,
    left: index * 900,
    top: 0,
    width: 900,
    height: 900,
  }));
}

function seed(): {
  state: WorkspaceState;
  createId: ReturnType<typeof createSequentialIdFactory>;
  groupRects: GroupRect[];
} {
  const createId = createSequentialIdFactory();
  let state = applyWorkspaceTemplate(createWorkspaceState(createId), 'columns', createId);
  const groups = listStageGroupIds(state.stage);
  const first = groups[0];
  const second = groups[1];
  if (!first || !second) throw new Error('missing template groups');
  const a = openSessionView(state, 'a', createId, first);
  if (!a.ok) throw new Error('open a failed');
  state = a.state;
  const b = openSessionView(state, 'b', createId, second);
  if (!b.ok) throw new Error('open b failed');
  state = b.state;
  const c = openSessionView(state, 'c', createId, second);
  if (!c.ok) throw new Error('open c failed');
  return { state: c.state, createId, groupRects: rects(groups) };
}

describe('docking drag resolution', () => {
  it('resolves a group edge drop into a split preview and commits it', () => {
    const { state, createId, groupRects } = seed();
    const root = document.createElement('div');
    const viewId = Object.values(state.views).find((view) => view.sessionId === 'c')?.viewId;
    if (!viewId) throw new Error('missing view c');
    const applied: WorkspaceState[] = [];

    const resolution = resolveDockDrag({
      state,
      source: { kind: 'view', viewId },
      point: { x: 880, y: 400 },
      root,
      stageSize: STAGE,
      groupRects,
      panelElement: null,
      rightPanelVisible: false,
      createId,
      apply: (next) => applied.push(next),
    });

    expect(resolution?.preview.ok).toBe(true);
    expect(resolution?.preview.label).toBe(DOCKING_COPY.splitRight);
    expect(resolution?.preview.highlight).toEqual([
      { kind: 'split', edge: 'right', left: 450, top: 0, width: 450, height: 900 },
    ]);
    resolution?.commit();
    expect(applied).toHaveLength(1);
    const committed = applied[0];
    expect(committed ? stageGroupCount(committed.stage) : 0).toBe(3);
  });

  it('rejects a session dropped on the right dock band with product copy', () => {
    const { state, createId, groupRects } = seed();
    const root = document.createElement('div');
    const viewId = Object.values(state.views).find((view) => view.sessionId === 'a')?.viewId;
    if (!viewId) throw new Error('missing view a');
    const resolution = resolveDockDrag({
      state,
      source: { kind: 'view', viewId },
      point: { x: 1770, y: 400 },
      root,
      stageSize: STAGE,
      groupRects,
      panelElement: null,
      rightPanelVisible: false,
      createId,
      apply: () => undefined,
    });
    expect(resolution?.preview.ok).toBe(false);
    expect(resolution?.preview.message).toBe(DOCKING_COPY.sessionNotInRight);
    expect(resolution?.preview.highlight).toEqual([]);
  });

  it('returns null when the pointer leaves the workspace', () => {
    const { state, createId, groupRects } = seed();
    const root = document.createElement('div');
    const resolution = resolveDockDrag({
      state,
      source: { kind: 'view', viewId: Object.keys(state.views)[0] ?? '' },
      point: { x: -50, y: 400 },
      root,
      stageSize: STAGE,
      groupRects,
      panelElement: null,
      rightPanelVisible: false,
      createId,
      apply: () => undefined,
    });
    expect(resolution).toBeNull();
  });

  it('reads tab hit areas from the DOM with their index', () => {
    const root = document.createElement('div');
    const tab = document.createElement('button');
    tab.setAttribute('data-docking-tab', 'view-1');
    tab.setAttribute('data-docking-tab-group', 'g1');
    tab.setAttribute('data-docking-tab-index', '2');
    root.appendChild(tab);
    const orphan = document.createElement('button');
    orphan.setAttribute('data-docking-tab', 'view-2');
    root.appendChild(orphan);

    const areas = collectTabAreas(root, '[data-docking-tab]', 'data-docking-tab-group', 'data-docking-tab-index');
    expect(areas).toHaveLength(1);
    expect(areas[0]?.groupId).toBe('g1');
    expect(areas[0]?.index).toBe(2);
  });

  it('converts client coordinates into stage-local space', () => {
    const origin = document.createElement('div');
    origin.getBoundingClientRect = () =>
      ({
        x: 200,
        y: 80,
        left: 200,
        top: 80,
        width: 1800,
        height: 900,
        right: 2000,
        bottom: 980,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    expect(toLocalPoint(origin, { x: 1080, y: 480 })).toEqual({ x: 880, y: 400 });
  });

  it('reads right-panel tabs from the panel subtree', () => {
    const stage = document.createElement('div');
    const panel = document.createElement('div');
    const tab = document.createElement('button');
    tab.setAttribute('data-docking-right-tab', 'v');
    tab.setAttribute('data-docking-right-tab-group', 'right');
    tab.setAttribute('data-docking-right-tab-index', '0');
    panel.appendChild(tab);
    const areas = collectTabAreas(
      stage,
      '[data-docking-right-tab]',
      'data-docking-right-tab-group',
      'data-docking-right-tab-index',
      panel,
    );
    expect(areas).toHaveLength(1);
    expect(areas[0]?.groupId).toBe('right');
  });
});
