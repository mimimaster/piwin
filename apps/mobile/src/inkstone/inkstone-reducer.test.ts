import { describe, expect, it } from 'vitest';
import { INITIAL_INKSTONE_STATE, inkstoneReducer } from './inkstone-state.js';

describe('inkstoneReducer', () => {
  it('folds merged destinations and closes the open sheet on navigation', () => {
    const withSheet = inkstoneReducer(INITIAL_INKSTONE_STATE, { type: 'open-sheet', key: 'model' });
    expect(withSheet.sheet).toBe('model');
    const inbox = inkstoneReducer(withSheet, { type: 'navigate', route: 'inbox' });
    expect(inbox).toMatchObject({ route: 'activity', sheet: null });
    expect(inkstoneReducer(INITIAL_INKSTONE_STATE, { type: 'navigate', route: 'settings' }).route).toBe('desk');
  });

  it('opens a settings section on its detail page', () => {
    expect(inkstoneReducer(INITIAL_INKSTONE_STATE, { type: 'settings-section', section: 'Hooks' })).toMatchObject({
      route: 'settings-detail',
      settingsSection: 'Hooks',
    });
  });

  it('bumps the toast sequence so the same message shows again', () => {
    const once = inkstoneReducer(INITIAL_INKSTONE_STATE, { type: 'toast', message: '已保存' });
    const twice = inkstoneReducer(once, { type: 'toast', message: '已保存' });
    expect(twice.toast).toEqual({ seq: 2, message: '已保存' });
  });

  it('toggles the paper / ink face', () => {
    expect(inkstoneReducer(INITIAL_INKSTONE_STATE, { type: 'toggle-face' }).face).toBe('ink');
  });

  it('opens a draft on the chat page and hands its first message to the created session', () => {
    const draft = inkstoneReducer(
      { ...INITIAL_INKSTONE_STATE, sheet: 'attach' },
      { type: 'start-draft', draft: { mode: 'agent', projectId: 'p1' } },
    );
    expect(draft).toMatchObject({ route: 'chat', sheet: null, draft: { mode: 'agent', projectId: 'p1' } });

    const moved = inkstoneReducer(draft, { type: 'set-draft-project', projectId: 'p2' });
    expect(moved.draft?.projectId).toBe('p2');

    const created = inkstoneReducer(moved, { type: 'draft-created', sessionId: 's9', text: '开始吧' });
    expect(created.draft).toBeNull();
    expect(created.pendingFirstSend).toEqual({ sessionId: 's9', text: '开始吧' });
    expect(inkstoneReducer(created, { type: 'first-send-done' }).pendingFirstSend).toBeNull();
  });

  it('drops the draft when navigating anywhere', () => {
    const draft = inkstoneReducer(INITIAL_INKSTONE_STATE, {
      type: 'start-draft',
      draft: { mode: 'chat', projectId: undefined },
    });
    expect(inkstoneReducer(draft, { type: 'navigate', route: 'chat' }).draft).toBeNull();
  });

  it('ignores a project pick when no draft is open', () => {
    expect(inkstoneReducer(INITIAL_INKSTONE_STATE, { type: 'set-draft-project', projectId: 'p1' })).toBe(
      INITIAL_INKSTONE_STATE,
    );
  });
});
