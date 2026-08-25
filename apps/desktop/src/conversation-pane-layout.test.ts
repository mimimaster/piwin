import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_PANE_MAX_RATIO,
  CONVERSATION_PANE_MIN_RATIO,
  PRIMARY_CONVERSATION_PANE_ID,
  applyConversationPanePreset,
  bindConversationPaneSession,
  closeConversationPane,
  createConversationPaneLayout,
  listConversationPaneLeaves,
  setConversationPaneSplitRatio,
  splitConversationPane,
  toggleMaximizedConversationPane,
  type ConversationPaneIdFactory,
} from './conversation-pane-layout.js';
import {
  focusConversationPaneDirection,
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
    const third = leaves[2];
    if (!first || !third) throw new Error('four-pane preset did not create enough panes');
    layout = { ...layout, activePaneId: first.paneId };
    layout = focusConversationPaneDirection(layout, 'right');
    expect(layout.activePaneId).toBe(third.paneId);
    layout = resizeFocusedConversationPane(layout, 'left', 1);
    const rootSplit = layout.root.kind === 'split' ? layout.root : null;
    expect(rootSplit?.ratio).toBe(CONVERSATION_PANE_MIN_RATIO);
    if (rootSplit) {
      layout = setConversationPaneSplitRatio(layout, rootSplit.splitId, 999);
      expect(layout.root.kind === 'split' ? layout.root.ratio : null).toBe(
        CONVERSATION_PANE_MAX_RATIO,
      );
    }
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
});
