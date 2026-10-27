/**
 * Dense rails: when the turns do not fit the rail at one tick per turn,
 * neighbouring ticks merge into evenly sized segments so the whole session
 * fits without the rail scrolling. A segment keeps its range and the union
 * of its marks; its first tick is the jump target and the preview.
 */
import {
  SESSION_USER_MESSAGE_TURN_MARKS,
  type SessionUserMessageTurnMark,
} from '@piwin/contracts';
import type { HistoryTickMessage } from './history-tick-messages.js';
import {
  COLLAPSED_TICK_HEIGHT_PX,
  COLLAPSED_TICK_PADDING_TOP_PX,
  COLLAPSED_TICK_STEP_PX,
} from './history-tick-geometry.js';

export type HistoryTickGroup = {
  /** Id of the first tick: stable React key, test id and jump target. */
  id: string;
  first: HistoryTickMessage;
  /** Index of `first` in the tick list. */
  startTickIndex: number;
  /** Ticks merged into this group (1 when the rail fits every turn). */
  tickCount: number;
  spanStartOrdinal: number;
  spanEndOrdinal: number;
  /** Union of member marks, highest display priority first. */
  marks: readonly SessionUserMessageTurnMark[];
};

/** Ticks a rail of this height shows at the fixed tick step; Infinity when unmeasured. */
export function resolveHistoryTickCapacity(railHeightPx: number): number {
  if (!Number.isFinite(railHeightPx) || railHeightPx <= 0) return Number.POSITIVE_INFINITY;
  const usable = railHeightPx - COLLAPSED_TICK_PADDING_TOP_PX * 2 - COLLAPSED_TICK_HEIGHT_PX;
  return Math.max(1, Math.floor(usable / COLLAPSED_TICK_STEP_PX) + 1);
}

export function groupHistoryTicks(
  ticks: readonly HistoryTickMessage[],
  capacity: number,
): HistoryTickGroup[] {
  const groupCount = Math.min(ticks.length, Math.max(1, Math.floor(capacity)));
  const groups: HistoryTickGroup[] = [];
  for (let group = 0; group < groupCount; group += 1) {
    const start = Math.floor((group * ticks.length) / groupCount);
    const end = Math.floor(((group + 1) * ticks.length) / groupCount);
    const first = ticks[start];
    const last = ticks[end - 1];
    if (!first || !last) continue;
    groups.push({
      id: first.id,
      first,
      startTickIndex: start,
      tickCount: end - start,
      spanStartOrdinal: first.spanStartOrdinal,
      spanEndOrdinal: last.spanEndOrdinal,
      marks: end - start === 1 ? first.marks : unionMarks(ticks.slice(start, end)),
    });
  }
  return groups;
}

/** Group holding a tick index (the reader's turn), or null. */
export function findHistoryTickGroupIndex(
  groups: readonly HistoryTickGroup[],
  tickIndex: number | null,
): number | null {
  if (tickIndex === null) return null;
  let low = 0;
  let high = groups.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const group = groups[middle];
    if (!group) return null;
    if (tickIndex < group.startTickIndex) high = middle - 1;
    else if (tickIndex >= group.startTickIndex + group.tickCount) low = middle + 1;
    else return middle;
  }
  return null;
}

function unionMarks(ticks: readonly HistoryTickMessage[]): SessionUserMessageTurnMark[] {
  const found = new Set<SessionUserMessageTurnMark>();
  for (const tick of ticks) for (const mark of tick.marks) found.add(mark);
  return SESSION_USER_MESSAGE_TURN_MARKS.filter((mark) => found.has(mark));
}
