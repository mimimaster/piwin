import { describe, expect, it } from 'vitest';
import {
  PRIMARY_CONVERSATION_PANE_ID,
  applyConversationPanePreset,
  bindConversationPaneSession,
  createConversationPaneLayout,
  listConversationPaneLeaves,
  splitConversationPane,
} from '../../conversation-pane-layout.js';
import { DOCKING_COPY } from './copy.js';
import { createSequentialIdFactory } from './ids.js';
import { migrateConversationPaneLayout, migrateDamagedLayout } from './migrate.js';
import { listStageGroupIds, stageGroupCount } from './topology.js';

function createIds() {
  let pane = 0;
  let split = 0;
  return (kind: 'pane' | 'split') => (kind === 'pane' ? `pane-${++pane}` : `split-${++split}`);
}

describe('docking v1 migration', () => {
  it('preserves a legal two-pane layout as two groups', () => {
    let layout = createConversationPaneLayout('alpha');
    layout = splitConversationPane(layout, PRIMARY_CONVERSATION_PANE_ID, 'row', createIds());
    layout = bindConversationPaneSession(layout, 'pane-1', 'beta');
    const migrated = migrateConversationPaneLayout(layout, createSequentialIdFactory());
    expect(stageGroupCount(migrated.state.stage)).toBe(2);
    expect(
      Object.values(migrated.state.views)
        .map((view) => view.sessionId)
        .sort(),
    ).toEqual(['alpha', 'beta']);
    expect(migrated.notice).toBeNull();
  });

  it('folds 5–8 panes into a quad with leftover sessions as tabs on group 4', () => {
    let layout = applyConversationPanePreset(createConversationPaneLayout('s0'), 8, createIds());
    const leaves = listConversationPaneLeaves(layout.root);
    for (let index = 1; index < leaves.length; index += 1) {
      const leaf = leaves[index];
      if (!leaf) continue;
      layout = bindConversationPaneSession(layout, leaf.paneId, `s${String(index)}`);
    }
    const migrated = migrateConversationPaneLayout(layout, createSequentialIdFactory());
    expect(stageGroupCount(migrated.state.stage)).toBe(4);
    const groupIds = listStageGroupIds(migrated.state.stage);
    const fourth = groupIds[3];
    expect(fourth).toBeTruthy();
    expect(fourth ? migrated.state.groups[fourth]?.viewIds.length : 0).toBe(5);
    expect(migrated.notice).toBe(DOCKING_COPY.migrateNotice(5));
    expect(Object.keys(migrated.state.views)).toHaveLength(8);
  });

  it('extracts recognizable session ids from damaged json instead of wiping', () => {
    const migrated = migrateDamagedLayout(
      { version: 1, root: { kind: 'leaf', paneId: 'x', sessionId: 'survived' }, extra: { sessionId: 'also' } },
      createSequentialIdFactory(),
    );
    const sessions = Object.values(migrated.state.views).map((view) => view.sessionId).sort();
    expect(sessions).toEqual(['also', 'survived']);
    expect(listStageGroupIds(migrated.state.stage)).toHaveLength(1);
  });
});
