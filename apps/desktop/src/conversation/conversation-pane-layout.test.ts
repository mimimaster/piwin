import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_PANE_MAX_RATIO,
  CONVERSATION_PANE_MIN_HEIGHT,
  CONVERSATION_PANE_MIN_WIDTH,
  CONVERSATION_PANE_MIN_RATIO,
  PRIMARY_CONVERSATION_PANE_ID,
  applyConversationPanePreset,
  bindConversationPaneSession,
  closeConversationPane,
  constrainConversationPaneLayout,
  createConversationPaneLayout,
  focusConversationPane,
  getConversationPaneMinimumSize,
  listConversationPaneLeaves,
  replacePrimaryConversationSession,
  resolveFocusedConversationSessionId,
  setConversationPaneSplitRatio,
  splitConversationPane,
  toggleMaximizedConversationPane,
  type ConversationPaneIdFactory,
} from './conversation-pane-layout.js';
import {
  focusConversationPaneDirection,
  listConversationPaneRects,
  resizeFocusedConversationPane,
} from './conversation-pane-navigation.js';

function createIds(): ConversationPaneIdFactory {
  let pane = 0;
  let split = 0;
  return (kind) => (kind === 'pane' ? `pane-${++pane}` : `split-${++split}`);
}

describe('conversation pane layout', () => {
  it('splits the focused pane and closes only supplementary leaves', () => {
    const createId = createIds();
    let layout = createConversationPaneLayout('session-primary');
    layout = splitConversationPane(layout, PRIMARY_CONVERSATION_PANE_ID, 'row', createId);
    expect(listConversationPaneLeaves(layout.root)).toEqual([
      { kind: 'leaf', paneId: PRIMARY_CONVERSATION_PANE_ID, sessionId: 'session-primary' },
      { kind: 'leaf', paneId: 'pane-1', sessionId: null },
    ]);
    expect(layout.activePaneId).toBe('pane-1');
    expect(closeConversationPane(layout, PRIMARY_CONVERSATION_PANE_ID)).toBe(layout);
    layout = closeConversationPane(layout, 'pane-1');
    expect(listConversationPaneLeaves(layout.root)).toHaveLength(1);
    expect(layout.activePaneId).toBe(PRIMARY_CONVERSATION_PANE_ID);
  });

  it('builds balanced 1/2/4/8 presets and retains visible bindings', () => {
    const createId = createIds();
    let layout = createConversationPaneLayout('session-primary');
    layout = applyConversationPanePreset(layout, 8, createId);
    expect(listConversationPaneLeaves(layout.root)).toHaveLength(8);
    const secondPane = listConversationPaneLeaves(layout.root)[1];
    if (!secondPane) throw new Error('eight-pane preset did not create a second pane');
    layout = bindConversationPaneSession(layout, secondPane.paneId, 'session-two');
    layout = applyConversationPanePreset(layout, 4, createId);
    expect(listConversationPaneLeaves(layout.root)).toHaveLength(4);
    expect(listConversationPaneLeaves(layout.root)[1]?.sessionId).toBe('session-two');
    layout = applyConversationPanePreset(layout, 1, createId);
    expect(listConversationPaneLeaves(layout.root)).toEqual([
      { kind: 'leaf', paneId: PRIMARY_CONVERSATION_PANE_ID, sessionId: 'session-primary' },
    ]);
  });

  it('lays preset panes out in reading order', () => {
    const rowsOf = (count: 2 | 4 | 8): number[][] => {
      const layout = applyConversationPanePreset(createConversationPaneLayout(), count, createIds());
      const order = new Map(
        listConversationPaneLeaves(layout.root).map((leaf, index) => [leaf.paneId, index + 1]),
      );
      const rows = new Map<number, Array<{ left: number; index: number }>>();
      for (const rect of listConversationPaneRects(layout.root)) {
        const row = rows.get(rect.top) ?? [];
        row.push({ left: rect.left, index: order.get(rect.paneId) ?? 0 });
        rows.set(rect.top, row);
      }
      return [...rows.entries()]
        .sort(([top], [otherTop]) => top - otherTop)
        .map(([, row]) => row.sort((a, b) => a.left - b.left).map((cell) => cell.index));
    };
    expect(rowsOf(2)).toEqual([[1, 2]]);
    expect(rowsOf(4)).toEqual([[1, 2], [3, 4]]);
    expect(rowsOf(8)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
  });

  it('focuses an existing pane instead of binding one session twice', () => {
    const createId = createIds();
    let layout = applyConversationPanePreset(createConversationPaneLayout('primary'), 4, createId);
    const leaves = listConversationPaneLeaves(layout.root);
    const second = leaves[1];
    const third = leaves[2];
    if (!second || !third) throw new Error('four-pane preset did not create enough panes');
    layout = bindConversationPaneSession(layout, second.paneId, 'shared');
    layout = bindConversationPaneSession(layout, third.paneId, 'shared');
    expect(layout.activePaneId).toBe(second.paneId);
    expect(
      listConversationPaneLeaves(layout.root).filter((leaf) => leaf.sessionId === 'shared'),
    ).toHaveLength(1);
  });

  it('navigates geometrically and clamps separator resize', () => {
    const createId = createIds();
    let layout = applyConversationPanePreset(createConversationPaneLayout(), 4, createId);
    const leaves = listConversationPaneLeaves(layout.root);
    const first = leaves[0];
    const second = leaves[1];
    const third = leaves[2];
    if (!first || !second || !third) throw new Error('four-pane preset did not create enough panes');
    layout = { ...layout, activePaneId: first.paneId };
    layout = focusConversationPaneDirection(layout, 'right');
    expect(layout.activePaneId).toBe(second.paneId);
    layout = focusConversationPaneDirection(layout, 'down');
    expect(layout.activePaneId).toBe(leaves[3]?.paneId);
    layout = { ...layout, activePaneId: second.paneId };
    layout = resizeFocusedConversationPane(layout, 'left', 1);
    const topRow =
      layout.root.kind === 'split' && layout.root.first.kind === 'split' ? layout.root.first : null;
    expect(topRow?.ratio).toBe(CONVERSATION_PANE_MIN_RATIO);
    if (topRow) {
      layout = setConversationPaneSplitRatio(layout, topRow.splitId, 999);
      const nextTopRow =
        layout.root.kind === 'split' && layout.root.first.kind === 'split' ? layout.root.first : null;
      expect(nextTopRow?.ratio).toBe(CONVERSATION_PANE_MAX_RATIO);
    }
  });

  it('keeps nested panes above their pixel minimum when the stage can fit them', () => {
    const createId = createIds();
    let layout = applyConversationPanePreset(createConversationPaneLayout(), 2, createId);
    const minimumSize = getConversationPaneMinimumSize(layout.root);
    expect(minimumSize).toEqual({
      width: CONVERSATION_PANE_MIN_WIDTH * 2,
      height: CONVERSATION_PANE_MIN_HEIGHT,
    });

    const rootSplit = layout.root.kind === 'split' ? layout.root : null;
    if (!rootSplit) throw new Error('two-pane preset did not create a split');
    layout = setConversationPaneSplitRatio(layout, rootSplit.splitId, 0.1);
    const constrained = constrainConversationPaneLayout(layout, { width: 1_000, height: 500 });

    expect(constrained.root.kind === 'split' ? constrained.root.ratio : null).toBeCloseTo(0.3);
  });

  it('keeps an impossible stage balanced instead of collapsing one branch', () => {
    const createId = createIds();
    let layout = applyConversationPanePreset(createConversationPaneLayout(), 2, createId);
    const rootSplit = layout.root.kind === 'split' ? layout.root : null;
    if (!rootSplit) throw new Error('two-pane preset did not create a split');
    layout = setConversationPaneSplitRatio(layout, rootSplit.splitId, 0.1);
    const constrained = constrainConversationPaneLayout(layout, { width: 500, height: 500 });

    expect(constrained.root.kind === 'split' ? constrained.root.ratio : null).toBeCloseTo(0.5);
  });

  it('maximizes and restores without changing the tree', () => {
    const createId = createIds();
    const initial = applyConversationPanePreset(createConversationPaneLayout(), 2, createId);
    const supplementaryPane = listConversationPaneLeaves(initial.root)[1];
    if (!supplementaryPane) throw new Error('two-pane preset did not create a second pane');
    const paneId = supplementaryPane.paneId;
    const maximized = toggleMaximizedConversationPane(initial, paneId);
    expect(maximized.maximizedPaneId).toBe(paneId);
    expect(maximized.root).toBe(initial.root);
    expect(toggleMaximizedConversationPane(maximized, paneId).maximizedPaneId).toBeNull();
  });

  it('resolves Live target from the focused pane session', () => {
    const createId = createIds();
    let layout = createConversationPaneLayout('session-primary');
    expect(
      resolveFocusedConversationSessionId({ layout, primarySessionId: 'session-primary' }),
    ).toBe('session-primary');
    layout = splitConversationPane(layout, PRIMARY_CONVERSATION_PANE_ID, 'row', createId);
    const second = listConversationPaneLeaves(layout.root)[1];
    if (!second) throw new Error('split did not create a second pane');
    expect(layout.activePaneId).toBe(second.paneId);
    expect(second.sessionId).toBeNull();
    // S-keep: empty secondary must not fall back to primarySessionId
    expect(
      resolveFocusedConversationSessionId({ layout, primarySessionId: 'session-primary' }),
    ).toBeNull();
    layout = bindConversationPaneSession(layout, second.paneId, 'session-two');
    expect(
      resolveFocusedConversationSessionId({ layout, primarySessionId: 'session-primary' }),
    ).toBe('session-two');
  });

  it('resume-fallback focus-primary makes Live resolve the resumed session', () => {
    const createId = createIds();
    let layout = createConversationPaneLayout('session-a');
    layout = splitConversationPane(layout, PRIMARY_CONVERSATION_PANE_ID, 'row', createId);
    expect(layout.activePaneId).not.toBe(PRIMARY_CONVERSATION_PANE_ID);
    expect(
      resolveFocusedConversationSessionId({ layout, primarySessionId: 'session-a' }),
    ).toBeNull();

    // Cannot bind secondary → focus primary, then primary resume replaces session
    layout = focusConversationPane(layout, PRIMARY_CONVERSATION_PANE_ID);
    expect(layout.activePaneId).toBe(PRIMARY_CONVERSATION_PANE_ID);
    layout = replacePrimaryConversationSession(layout, 'session-b');
    expect(
      resolveFocusedConversationSessionId({ layout, primarySessionId: 'session-b' }),
    ).toBe('session-b');
  });
});
