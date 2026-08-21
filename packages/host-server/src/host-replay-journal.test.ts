import { describe, expect, it } from 'vitest';
import type { HostSequencedPush } from '@piwin/contracts';
import { HostReplayJournal } from './host-replay-journal.js';

function record(seq: number): HostSequencedPush {
  return {
    seq,
    eventId: `event-${seq}`,
    push: { type: 'host/log', level: 'info', message: `log-${seq}` },
  };
}

describe('HostReplayJournal', () => {
  it('evicts by item count and reports replay completeness', () => {
    const journal = new HostReplayJournal({
      maxItems: 2,
      maxBytes: 10_000,
      maxAgeMs: 10_000,
      now: () => 100,
    });
    journal.append(record(1));
    journal.append(record(2));
    journal.append(record(3));

    expect(journal.getOldestSeq()).toBe(2);
    expect(journal.listSince(1).map((item) => item.seq)).toEqual([2, 3]);
    expect(journal.isCompleteSince(0)).toBe(false);
    expect(journal.isCompleteSince(1)).toBe(true);
  });

  it('evicts expired records without retaining payload copies indefinitely', () => {
    let now = 100;
    const journal = new HostReplayJournal({
      maxItems: 10,
      maxBytes: 10_000,
      maxAgeMs: 10,
      now: () => now,
    });
    journal.append(record(1));
    now = 111;
    expect(journal.listSince(0)).toEqual([]);
    expect(journal.getSize()).toEqual({ items: 0, bytes: 0 });
    expect(journal.isCompleteSince(0)).toBe(false);
  });
});
