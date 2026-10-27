import { describe, expect, it } from 'vitest';
import type { SessionUserMessageTurnMark } from '@piwin/contracts';
import type { HistoryTickMessage } from './history-tick-messages';
import {
  findHistoryTickGroupIndex,
  groupHistoryTicks,
  resolveHistoryTickCapacity,
} from './history-tick-groups';

function tick(ordinal: number, marks: SessionUserMessageTurnMark[] = []): HistoryTickMessage {
  return {
    id: `t${ordinal}`,
    text: `turn ${ordinal}`,
    ordinal,
    spanStartOrdinal: ordinal,
    spanEndOrdinal: ordinal,
    marks,
  };
}

describe('resolveHistoryTickCapacity', () => {
  it('fits ticks at the fixed pitch and is unbounded before measuring', () => {
    // 8px padding top and bottom, 1px ticks every 11px.
    expect(resolveHistoryTickCapacity(17)).toBe(1);
    expect(resolveHistoryTickCapacity(28)).toBe(2);
    expect(resolveHistoryTickCapacity(486)).toBe(43);
    expect(resolveHistoryTickCapacity(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('groupHistoryTicks', () => {
  it('keeps one tick per turn when they fit', () => {
    const groups = groupHistoryTicks([tick(0), tick(1), tick(2)], Number.POSITIVE_INFINITY);
    expect(groups.map((group) => [group.id, group.tickCount])).toEqual([
      ['t0', 1],
      ['t1', 1],
      ['t2', 1],
    ]);
  });

  it('merges dense ticks into even segments with ranges and mark unions', () => {
    const ticks = Array.from({ length: 10 }, (_, ordinal) =>
      tick(ordinal, ordinal === 3 ? ['artifact'] : ordinal === 4 ? ['error'] : []),
    );
    const groups = groupHistoryTicks(ticks, 4);
    expect(
      groups.map((group) => [group.id, group.spanStartOrdinal, group.spanEndOrdinal, group.marks]),
    ).toEqual([
      ['t0', 0, 1, []],
      ['t2', 2, 4, ['error', 'artifact']],
      ['t5', 5, 6, []],
      ['t7', 7, 9, []],
    ]);
  });

  it('finds the segment holding a tick', () => {
    const groups = groupHistoryTicks(
      Array.from({ length: 10 }, (_, ordinal) => tick(ordinal)),
      4,
    );
    expect(findHistoryTickGroupIndex(groups, 0)).toBe(0);
    expect(findHistoryTickGroupIndex(groups, 4)).toBe(1);
    expect(findHistoryTickGroupIndex(groups, 9)).toBe(3);
    expect(findHistoryTickGroupIndex(groups, null)).toBeNull();
    expect(findHistoryTickGroupIndex(groups, 10)).toBeNull();
  });
});
