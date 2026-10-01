import type {
  SessionToolCardView,
  SessionTranscriptMessage,
  SessionTurnSummary,
} from '@piwin/contracts';
import { classifyCompactionNoOp } from '@piwin/contracts';

type WorkTool = Pick<SessionToolCardView, 'status'> & {
  presentation?: Pick<
    NonNullable<SessionToolCardView['presentation']>,
    'changedPaths' | 'targetPaths' | 'error'
  >;
  input?: unknown;
};
export type TranscriptWorkMessage = {
  tools?: readonly WorkTool[];
  status: string;
  error?: string;
};

/** One counting policy for Host totals and Desktop turn/segment headers. */
export function countTranscriptWork(messages: Iterable<TranscriptWorkMessage>): {
  toolCount: number;
  fileCount: number;
  failureCount: number;
} {
  let toolCount = 0;
  let failedTools = 0;
  let messageFailed = false;
  const files = new Set<string>();
  const addPath = (path: unknown): void => {
    if (typeof path === 'string' && path.trim()) files.add(path.trim());
  };
  for (const message of messages) {
    messageFailed ||= message.status === 'error' || message.error !== undefined;
    for (const tool of message.tools ?? []) {
      toolCount += 1;
      if (tool.status === 'error' && tool.presentation?.error?.category !== 'cancelled')
        failedTools += 1;
      for (const path of tool.presentation?.changedPaths ?? []) addPath(path);
      for (const path of tool.presentation?.targetPaths ?? []) addPath(path);
      addPath((tool.presentation as { targetPath?: unknown } | undefined)?.targetPath);
      if (tool.input !== null && typeof tool.input === 'object') {
        const input = tool.input as Record<string, unknown>;
        for (const key of ['path', 'filePath', 'targetFile', 'file']) addPath(input[key]);
      }
    }
  }
  return { toolCount, fileCount: files.size, failureCount: failedTools || (messageFailed ? 1 : 0) };
}

/** Union of working intervals: overlapping runs count once; idle pauses do not count. */
export function sumWorkedIntervals(
  intervals: readonly (readonly [number, number])[],
): number | undefined {
  if (intervals.length === 0) return undefined;
  const sorted = [...intervals].sort((left, right) => left[0] - right[0]);
  let [start, end] = sorted[0] ?? [0, 0];
  let total = 0;
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart > end) {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    } else end = Math.max(end, nextEnd);
  }
  return total + end - start;
}

/** Lightweight message projection; no prose, thinking, media or tool output needed. */
export type TurnSummaryMessage = Pick<
  SessionTranscriptMessage,
  | 'id'
  | 'role'
  | 'createdAt'
  | 'status'
  | 'runId'
  | 'startedAt'
  | 'endedAt'
  | 'outcome'
  | 'terminalMessage'
  | 'thinkingStartedAt'
  | 'thinkingEndedAt'
> & {
  tools?: readonly WorkTool[];
};

/** Streaming iteration bounds temporary memory to one turn's work metadata. */
export function buildSessionTurnSummaries(
  messages: Iterable<TurnSummaryMessage>,
  revision: string,
): SessionTurnSummary[] {
  const summaries: SessionTurnSummary[] = [];
  let rows: TurnSummaryMessage[] = [];
  let startIndex = 0;
  let sourceIndex = 0;
  const finish = (): void => {
    const first = rows[0];
    if (first === undefined) return;
    const stats = countTranscriptWork(
      rows.map((row) => ({
        status:
          row.outcome === 'paused' ||
          (row.terminalMessage && classifyCompactionNoOp(row.terminalMessage))
            ? 'done'
            : row.outcome === 'failed'
              ? 'error'
              : row.status,
        ...(row.tools ? { tools: row.tools } : {}),
        ...(row.terminalMessage &&
        row.outcome !== 'paused' &&
        !classifyCompactionNoOp(row.terminalMessage)
          ? { error: row.terminalMessage }
          : {}),
      })),
    );
    const runBounds = new Map<string, { start?: number; end?: number }>();
    let earliest = Infinity;
    let latest = -Infinity;
    for (const row of rows) {
      if (row.role !== 'assistant') continue;
      const start = Date.parse(row.startedAt ?? '');
      const end = Date.parse(row.endedAt ?? '');
      if (row.runId) {
        const bounds = runBounds.get(row.runId) ?? {};
        if (Number.isFinite(start)) bounds.start = Math.min(bounds.start ?? start, start);
        if (Number.isFinite(end)) bounds.end = Math.max(bounds.end ?? end, end);
        runBounds.set(row.runId, bounds);
      }
      const rowStart = Date.parse(row.thinkingStartedAt ?? row.createdAt);
      const rowEnd = Date.parse(row.thinkingEndedAt ?? row.createdAt);
      if (Number.isFinite(rowStart)) earliest = Math.min(earliest, rowStart);
      if (Number.isFinite(rowEnd)) latest = Math.max(latest, rowEnd);
    }
    const intervals: Array<[number, number]> = [];
    for (const bounds of runBounds.values()) {
      if (bounds.start !== undefined && bounds.end !== undefined)
        intervals.push([bounds.start, Math.max(bounds.start, bounds.end)]);
    }
    const elapsedMs =
      sumWorkedIntervals(intervals) ??
      (Number.isFinite(earliest) && Number.isFinite(latest)
        ? Math.max(0, latest - earliest)
        : undefined);
    summaries.push({
      turnId: `turn-${first.id}`,
      userMessageId: first.role === 'user' ? first.id : null,
      firstMessageId: first.id,
      revision,
      startIndex,
      endIndex: sourceIndex,
      ...stats,
      ...(elapsedMs === undefined ? {} : { elapsedMs }),
    });
    rows = [];
  };
  for (const message of messages) {
    if (message.role === 'user' && rows.length > 0) finish();
    if (rows.length === 0) startIndex = sourceIndex;
    rows.push(message);
    sourceIndex += 1;
  }
  finish();
  return summaries;
}

export function selectSessionTurnSummaries(
  summaries: readonly SessionTurnSummary[],
  startIndex: number,
  endIndex: number,
): SessionTurnSummary[] {
  if (endIndex <= startIndex) return [];
  return summaries.filter(
    (summary) => summary.startIndex < endIndex && summary.endIndex > startIndex,
  );
}
