import { describe, expect, it } from 'vitest';
import { createTransportTimingBuffer } from './transport-timing.js';

describe('createTransportTimingBuffer', () => {
  it('records and snapshots timing points', () => {
    let clock = 0;
    const buffer = createTransportTimingBuffer({ now: () => clock });

    clock = 100;
    buffer.record('prompt/accepted', { correlationId: 'run-1' });
    clock = 350;
    buffer.record('run/first-token', { correlationId: 'run-1' });

    const snapshot = buffer.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]?.label).toBe('prompt/accepted');
    expect(snapshot[0]?.atMs).toBe(100);
    expect(snapshot[1]?.label).toBe('run/first-token');
    expect(snapshot[1]?.atMs).toBe(350);
  });

  it('computes elapsed time between two labels', () => {
    let clock = 0;
    const buffer = createTransportTimingBuffer({ now: () => clock });

    clock = 0;
    buffer.record('abort/requested', { correlationId: 'run-1' });
    clock = 42;
    buffer.record('run/terminal', { correlationId: 'run-1', detail: 'cancelled' });

    const elapsed = buffer.elapsedBetween('run-1', 'abort/requested', 'run/terminal');
    expect(elapsed).toBe(42);
  });

  it('returns null for missing labels or correlation ids', () => {
    const buffer = createTransportTimingBuffer({ now: () => 0 });
    buffer.record('a', { correlationId: 'x' });

    expect(buffer.elapsedBetween('x', 'a', 'missing')).toBeNull();
    expect(buffer.elapsedBetween('missing-id', 'a', 'a')).toBeNull();
  });

  it('evicts oldest records when over capacity', () => {
    let clock = 0;
    const buffer = createTransportTimingBuffer({ maxRecords: 3, now: () => clock });

    for (let index = 0; index < 5; index += 1) {
      clock = index * 10;
      buffer.record(`event-${index}`);
    }

    expect(buffer.size).toBe(3);
    const labels = buffer.snapshot().map((record) => record.label);
    expect(labels).toEqual(['event-2', 'event-3', 'event-4']);
  });

  it('filters by correlation id', () => {
    let clock = 0;
    const buffer = createTransportTimingBuffer({ now: () => clock });

    clock = 1;
    buffer.record('a', { correlationId: 'run-1' });
    clock = 2;
    buffer.record('b', { correlationId: 'run-2' });
    clock = 3;
    buffer.record('c', { correlationId: 'run-1' });

    const run1 = buffer.byCorrelation('run-1');
    expect(run1).toHaveLength(2);
    expect(run1.map((record) => record.label)).toEqual(['a', 'c']);
  });

  it('clear removes all records', () => {
    const buffer = createTransportTimingBuffer({ now: () => 0 });
    buffer.record('x');
    buffer.record('y');
    expect(buffer.size).toBe(2);

    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.snapshot()).toEqual([]);
  });
});
