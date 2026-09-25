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
});
