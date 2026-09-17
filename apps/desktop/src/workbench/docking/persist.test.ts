import { describe, expect, it } from 'vitest';
import { CONVERSATION_PANE_STORAGE_KEY } from '../../conversation-pane-storage.js';
import { createConversationPaneLayout } from '../../conversation-pane-layout.js';
import { CONVERSATION_PANE_V1_BACKUP_SUFFIX } from './constants.js';
import { createSequentialIdFactory } from './ids.js';
import {
  backupConversationPaneV1,
  loadWorkspaceState,
  parseWorkspaceState,
  saveWorkspaceState,
  serializeWorkspaceState,
} from './persist.js';
import { createWorkspaceState, openSessionView, openToolView } from './view-commands.js';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('docking persist', () => {
  it('round-trips v2 state without persisting transient maximize', () => {
    const createId = createSequentialIdFactory();
    const opened = openSessionView(createWorkspaceState(createId), 'live', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const maximized = { ...opened.state, displayMode: 'maximized' as const, maximizedGroupId: opened.state.activeGroupId };
    const parsed = parseWorkspaceState(serializeWorkspaceState(maximized));
    expect(parsed?.displayMode).toBe('normal');
    expect(parsed?.maximizedGroupId).toBeNull();
    expect(parsed?.sessionTargetId).toBe('live');
  });

  it('ignores the right panel width and collapsed state older layouts saved', () => {
    const createId = createSequentialIdFactory();
    const opened = openToolView(createWorkspaceState(createId), 'canvas', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const serialized = serializeWorkspaceState(opened.state) as { rightPanel: Record<string, unknown> };
    expect(serialized.rightPanel).toEqual({ groupIds: opened.state.rightPanel.groupIds });
    const legacy = { ...serialized, rightPanel: { ...serialized.rightPanel, collapsed: true, width: 512 } };
    expect(parseWorkspaceState(legacy)?.rightPanel).toEqual({ groupIds: opened.state.rightPanel.groupIds });
  });

  it('drops cloned tool views saved by older layouts', () => {
    const createId = createSequentialIdFactory();
    const opened = openToolView(createWorkspaceState(createId), 'canvas', createId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const rightGroupId = opened.state.rightPanel.groupIds[0] ?? '';
    const rightGroup = opened.state.groups[rightGroupId];
    if (!rightGroup) throw new Error('missing right group');
    const clone = { viewId: 'view-clone', kind: 'canvas' as const };
    const cloned = {
      ...opened.state,
      views: { ...opened.state.views, [clone.viewId]: clone },
      groups: {
        ...opened.state.groups,
        [rightGroupId]: { ...rightGroup, viewIds: [...rightGroup.viewIds, clone.viewId], activeViewId: clone.viewId },
      },
    };
    const parsed = parseWorkspaceState(serializeWorkspaceState(cloned));
    expect(Object.values(parsed?.views ?? {}).filter((view) => view.kind === 'canvas')).toHaveLength(1);
    expect(parsed?.groups[rightGroupId]?.viewIds).toEqual(rightGroup.viewIds);
    expect(parsed?.groups[rightGroupId]?.activeViewId).toBe(rightGroup.viewIds[0]);
  });

  it('migrates v1 storage after writing a one-shot backup', () => {
    const storage = new MemoryStorage();
    storage.setItem(CONVERSATION_PANE_STORAGE_KEY, JSON.stringify(createConversationPaneLayout('legacy')));
    backupConversationPaneV1(storage);
    expect(storage.getItem(`${CONVERSATION_PANE_STORAGE_KEY}${CONVERSATION_PANE_V1_BACKUP_SUFFIX}`)).toContain('legacy');
    const loaded = loadWorkspaceState(createSequentialIdFactory(), storage);
    expect(loaded.migrated).toBe(true);
    expect(Object.values(loaded.state.views).some((view) => view.sessionId === 'legacy')).toBe(true);
    saveWorkspaceState(loaded.state, storage);
    const again = loadWorkspaceState(createSequentialIdFactory(), storage);
    expect(again.migrated).toBe(false);
    expect(Object.values(again.state.views).some((view) => view.sessionId === 'legacy')).toBe(true);
  });
});
