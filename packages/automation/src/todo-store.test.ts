import { describe, expect, it } from 'vitest';
import { SessionTodoStore } from './todo-store.js';

describe('SessionTodoStore', () => {
  it('bumps revision on set and keeps sessions independent', () => {
    const store = new SessionTodoStore();
    const empty = store.get('session-a');
    const written = store.set('session-a', [
      { id: 't1', content: 'one', status: 'pending' },
    ]);
    expect(written.revision).not.toBe(empty.revision);
    expect(store.get('session-b').items).toEqual([]);
    expect(store.get('session-b').revision).not.toBe(written.revision);
  });
});
