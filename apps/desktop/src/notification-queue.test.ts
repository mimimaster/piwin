import { describe, expect, it } from 'vitest';
import {
  createEmptyNotificationState,
  notificationReducer,
  pushError,
  pushSuccess,
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
});
