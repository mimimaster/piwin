import { describe, expect, it, vi } from 'vitest';
import { appendHostLogEntry } from './HostLogPanel';
import { createHostLogStore } from './host-log-context';

describe('createHostLogStore', () => {
  it('applies setter updates and notifies subscribers', () => {
    const store = createHostLogStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setEntries((current) =>
      appendHostLogEntry(current, { level: 'warn', message: 'first', at: 't1' }),
    );
    expect(store.getEntries().map((entry) => entry.message)).toEqual(['first']);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.clear();
    expect(store.getEntries()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when an update keeps the same entries', () => {
    const store = createHostLogStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setEntries((current) => current);
    store.clear();
    expect(listener).not.toHaveBeenCalled();
  });
});
