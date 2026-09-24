import type { RunRecordUi } from './chat-reducer.js';
import type { TranscriptTurn } from './transcript-turns.js';

/**
 * Time the turn's runs actually spent working: the union of their intervals.
 * A paused-then-resumed turn has two runs with the idle pause between them;
 * spanning first start to last end would count that gap as work. Overlapping
 * runs (a subagent inside its parent) count once. `endedBy` keeps only runs
 * that finished by then — the work before a resumed run started.
 */
function sumRunWorkedMs(
  runIds: ReadonlySet<string>,
  runRecordsById: Readonly<Record<string, RunRecordUi>>,
  endedBy?: number,
): number | undefined {
  const intervals: Array<[number, number]> = [];
  for (const runId of runIds) {
    const record = runRecordsById[runId];
    if (!record || record.startedAt === null || record.endedAt === null) continue;
    if (endedBy !== undefined && record.endedAt > endedBy) continue;
    intervals.push([record.startedAt, Math.max(record.startedAt, record.endedAt)]);
  }
  if (intervals.length === 0) return undefined;
  intervals.sort((left, right) => left[0] - right[0]);
  let total = 0;
  let [spanStart, spanEnd] = intervals[0] ?? [0, 0];
  for (const [start, end] of intervals.slice(1)) {
    if (start > spanEnd) {
      total += spanEnd - spanStart;
      spanStart = start;
      spanEnd = end;
    } else {
      spanEnd = Math.max(spanEnd, end);
    }
  }
  return total + (spanEnd - spanStart);
}

export function resolveElapsedMs(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
  runIds: ReadonlySet<string>,
  runRecordsById: Readonly<Record<string, RunRecordUi>>,
): number | undefined {
  const workedMs = sumRunWorkedMs(runIds, runRecordsById);
  if (workedMs !== undefined) return workedMs;

  let earliestStart: number | undefined;
  let latestEnd: number | undefined;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (!message) continue;
    const msgStart =
      message.thinkingStartedAt ??
      (message.createdAt ? Date.parse(message.createdAt) : undefined);
    const msgEnd =
      message.thinkingEndedAt ??
      (message.createdAt ? Date.parse(message.createdAt) : undefined);

    if (msgStart !== undefined && !Number.isNaN(msgStart)) {
      earliestStart =
        earliestStart === undefined ? msgStart : Math.min(earliestStart, msgStart);
    }
    if (msgEnd !== undefined && !Number.isNaN(msgEnd)) {
      latestEnd = latestEnd === undefined ? msgEnd : Math.max(latestEnd, msgEnd);
    }
  }

  if (earliestStart === undefined || latestEnd === undefined) return undefined;
  return Math.max(0, latestEnd - earliestStart);
}

/**
 * Start of the live clock. After a pause the active run is a fresh run in the
 * same turn: the clock picks up from the work already done instead of counting
 * the pause, so it reads the same as the settled 已工作 total will.
 */
export function resolveRunStartedAt(
  runIds: ReadonlySet<string>,
  runRecordsById: Readonly<Record<string, RunRecordUi>>,
  activeRunId: string | null,
): number | undefined {
  const activeStartedAt =
    activeRunId !== null && runIds.has(activeRunId)
      ? runRecordsById[activeRunId]?.startedAt
      : undefined;
  if (activeStartedAt !== null && activeStartedAt !== undefined) {
    return activeStartedAt - (sumRunWorkedMs(runIds, runRecordsById, activeStartedAt) ?? 0);
  }
  let earliest: number | undefined;
  for (const runId of runIds) {
    const startedAt = runRecordsById[runId]?.startedAt;
    if (startedAt === null || startedAt === undefined) continue;
    earliest = earliest === undefined ? startedAt : Math.min(earliest, startedAt);
  }
  return earliest;
}
