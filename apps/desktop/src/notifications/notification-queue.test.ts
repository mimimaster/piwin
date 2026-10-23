import { describe, expect, it } from 'vitest';
import {
  createEmptyNotificationState,
  emitDesktopNotification,
  notificationReducer,
  pushError,
  pushInfo,
  pushSuccess,
  pushWarning,
} from './notification-queue';

describe('notificationReducer', () => {
  it('pushes newest first and caps length', () => {
    let state = createEmptyNotificationState();
    for (let index = 0; index < 7; index += 1) {
      state = notificationReducer(state, {
        type: 'notify/push',
        notification: { level: 'info', message: `m${index}` },
      });
    }
    expect(state.items).toHaveLength(5);
    expect(state.items[0]?.message).toBe('m6');
  });

  it('dismisses by id', () => {
    let state = createEmptyNotificationState();
    state = notificationReducer(state, {
      type: 'notify/push',
      notification: { id: 'a', level: 'success', message: 'ok', ttlMs: 1000 },
    });
    state = notificationReducer(state, pushError('boom'));
    state = notificationReducer(state, { type: 'notify/dismiss', id: 'a' });
    expect(state.items.some((item) => item.id === 'a')).toBe(false);
    expect(state.items[0]?.level).toBe('error');
  });

  it('success defaults auto-dismiss ttl', () => {
    const state = notificationReducer(createEmptyNotificationState(), pushSuccess('saved'));
    expect(state.items[0]?.ttlMs).toBeGreaterThan(0);
  });

  it('supports pushWarning and pushInfo action creators', () => {
    let state = createEmptyNotificationState();
    state = notificationReducer(state, pushWarning('disk almost full'));
    state = notificationReducer(state, pushInfo('indexing done'));

    expect(state.items).toHaveLength(2);
    expect(state.items[0]?.level).toBe('info');
    expect(state.items[0]?.message).toBe('indexing done');
    expect(state.items[1]?.level).toBe('warning');
    expect(state.items[1]?.message).toBe('disk almost full');
  });

  it('emitDesktopNotification safely returns id even in non-DOM', () => {
    const id = emitDesktopNotification({ level: 'info', message: 'hello' });
    expect(typeof id).toBe('string');
  });
});
