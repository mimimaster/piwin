import { describe, expect, it } from 'vitest';
import { applyWorkspaceTemplate, createWorkspaceState, openSessionView, setSplitRatio } from './commands.js';
import {
  allocateSplitSize,
  listStageRects,
  listStageSeparatorRects,
  resolveWorkspacePresentation,
  shouldExitFocusedMode,
  stageMinSize,
} from './geometry.js';
import { createSequentialIdFactory } from './ids.js';

describe('docking geometry', () => {
  it('allocates display sizes without requiring the caller to rewrite ratio', () => {
    const allocated = allocateSplitSize(1000, 0.7, 420, 420);
    expect(allocated.first).toBe(580);
    expect(allocated.second).toBe(420);
    const wide = allocateSplitSize(2000, 0.7, 420, 420);
    expect(wide.first).toBe(1400);
    expect(wide.second).toBe(600);
  });

  it('keeps stored 70/30 weights after computing narrow then wide rects', () => {
    const createId = createSequentialIdFactory();
    let state = applyWorkspaceTemplate(createWorkspaceState(createId), 'columns', createId);
    if (state.stage.kind !== 'split') throw new Error('expected split');
    state = setSplitRatio(state, state.stage.splitId, 0.7);
    const ratio = state.stage.kind === 'split' ? state.stage.ratio : 0;
    listStageRects(state, { left: 0, top: 0, width: 500, height: 600 });
    listStageRects(state, { left: 0, top: 0, width: 1400, height: 600 });
    expect(state.stage.kind === 'split' && state.stage.ratio).toBe(0.7);
    expect(ratio).toBe(0.7);
  });

  it('preserves the stored weight when the viewport cannot honor both minimums', () => {
    expect(allocateSplitSize(500, 0.7, 420, 420)).toEqual({ first: 350, second: 150 });
    expect(allocateSplitSize(0, 0.7, 420, 420)).toEqual({ first: 0, second: 0 });
  });

  it('uses +32px hysteresis before leaving focused presentation', () => {
    expect(shouldExitFocusedMode({ width: 851, height: 400 }, { width: 840, height: 320 })).toBe(false);
    expect(shouldExitFocusedMode({ width: 872, height: 400 }, { width: 840, height: 320 })).toBe(true);
  });

  it('drawers the right panel before collapsing a layout that still fits full width', () => {
    const createId = createSequentialIdFactory();
    let state = applyWorkspaceTemplate(createWorkspaceState(createId), 'columns', createId);
    const g0 = state.stage.kind === 'split' ? state.stage.first : null;
    const g1 = state.stage.kind === 'split' ? state.stage.second : null;
    const leftId = g0 && g0.kind === 'group' ? g0.groupId : null;
    const rightId = g1 && g1.kind === 'group' ? g1.groupId : null;
    if (!leftId || !rightId) throw new Error('missing groups');
    const a = openSessionView(state, 'a', createId, leftId);
    const b = a.ok ? openSessionView(a.state, 'b', createId, rightId) : a;
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    state = b.state;
    const min = stageMinSize(state);
    expect(min.width).toBeGreaterThanOrEqual(840);
    const presentation = resolveWorkspacePresentation({
      stageSize: { width: 900, height: 800 },
      rightPanelOpen: true,
      rightPanelWidth: 360,
      state,
    });
    expect(presentation).toBe('right-drawer');
  });
});

describe('docking separator geometry', () => {
  it('places the handle on the allocated seam, not the stored weight', () => {
    const createId = createSequentialIdFactory();
    let state = applyWorkspaceTemplate(createWorkspaceState(createId), 'columns', createId);
    if (state.stage.kind !== 'split') throw new Error('expected split');
    state = setSplitRatio(state, state.stage.splitId, 0.7);
    const wide = listStageSeparatorRects(state, { left: 0, top: 0, width: 1400, height: 600 });
    expect(wide).toHaveLength(1);
    expect(wide[0]?.boundary).toBeCloseTo(980, 6);
    // 500px cannot fit 420+420, so the weight survives and the seam moves with it.
    const narrow = listStageSeparatorRects(state, { left: 0, top: 0, width: 500, height: 600 });
    expect(narrow[0]?.boundary).toBeCloseTo(350, 6);
    expect(state.stage.kind === 'split' && state.stage.ratio).toBe(0.7);
  });
});
