import { describe, expect, it } from 'vitest';
import { appendHostLogEntry, type HostLogEntry } from './HostLogPanel';

describe('appendHostLogEntry', () => {
  it('assigns incremental ids and keeps newest at end', () => {
    const first = appendHostLogEntry([], {
      level: 'info',
      message: 'a',
      at: '2026-07-20T00:00:00.000Z',
    });
    const second = appendHostLogEntry(first, {
      level: 'warn',
      message: 'b',
      at: '2026-07-20T00:00:01.000Z',
    });
    expect(second).toHaveLength(2);
    expect(second[0]?.id).toBe(1);
    expect(second[1]?.id).toBe(2);
    expect(second[1]?.message).toBe('b');
  });

  it('trims to ring buffer max', () => {
    let entries: HostLogEntry[] = [];
    for (let index = 0; index < 5; index += 1) {
      entries = appendHostLogEntry(
        entries,
        {
          level: 'info',
          message: `line-${index}`,
          at: new Date().toISOString(),
        },
        3,
      );
    }
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.message)).toEqual([
      'line-2',
      'line-3',
      'line-4',
    ]);
  });
});
