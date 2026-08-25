import { describe, expect, it } from 'vitest';
import {
  PRIMARY_CONVERSATION_PANE_ID,
  applyConversationPanePreset,
  createConversationPaneLayout,
  listConversationPaneLeaves,
} from './conversation-pane-layout.js';
import {
  CONVERSATION_PANE_STORAGE_KEY,
  loadConversationPaneLayout,
  parseConversationPaneLayout,
  saveConversationPaneLayout,
} from './conversation-pane-storage.js';

describe('conversation pane storage', () => {
  it('round-trips a valid layout', () => {
    let sequence = 0;
    const layout = applyConversationPanePreset(
      createConversationPaneLayout('primary'),
      4,
      (kind) => `${kind}-${++sequence}`,
    );
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveConversationPaneLayout(layout, storage);
    expect(loadConversationPaneLayout(storage)).toEqual(layout);
    expect(values.has(CONVERSATION_PANE_STORAGE_KEY)).toBe(true);
  });

  it('rejects duplicate session bindings and a missing primary pane', () => {
    const duplicate = {
      version: 1,
      root: {
        kind: 'split',
        splitId: 'split-1',
        orientation: 'row',
        ratio: 0.5,
        first: { kind: 'leaf', paneId: PRIMARY_CONVERSATION_PANE_ID, sessionId: 'same' },
        second: { kind: 'leaf', paneId: 'pane-2', sessionId: 'same' },
      },
      activePaneId: PRIMARY_CONVERSATION_PANE_ID,
      maximizedPaneId: null,
    };
    expect(parseConversationPaneLayout(duplicate)).toBeNull();
    expect(
      parseConversationPaneLayout({
        version: 1,
        root: { kind: 'leaf', paneId: 'not-primary', sessionId: null },
        activePaneId: 'not-primary',
        maximizedPaneId: null,
      }),
    ).toBeNull();
  });

  it('falls back safely for malformed JSON', () => {
    const layout = loadConversationPaneLayout({ getItem: () => '{broken' });
    expect(listConversationPaneLeaves(layout.root)).toEqual([
      { kind: 'leaf', paneId: PRIMARY_CONVERSATION_PANE_ID, sessionId: null },
    ]);
  });
});
