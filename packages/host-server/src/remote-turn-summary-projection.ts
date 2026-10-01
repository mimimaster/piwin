import type { SessionTurnSummary } from '@piwin/contracts';

/** Explicit allowlist: complete turn totals contain no Host paths or tool payloads. */
export function projectRemoteTurnSummaries(values: readonly unknown[]): SessionTurnSummary[] {
  const summaries: SessionTurnSummary[] = [];
  for (const value of values.slice(0, 50)) {
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;
    if (
      typeof record.turnId !== 'string' ||
      typeof record.firstMessageId !== 'string' ||
      typeof record.revision !== 'string'
    )
      continue;
    const integer = (key: string): number => {
      const candidate = record[key];
      return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
        ? candidate
        : 0;
    };
    summaries.push({
      turnId: record.turnId.slice(0, 256),
      firstMessageId: record.firstMessageId.slice(0, 256),
      userMessageId:
        typeof record.userMessageId === 'string' ? record.userMessageId.slice(0, 256) : null,
      revision: record.revision.slice(0, 128),
      startIndex: integer('startIndex'),
      endIndex: integer('endIndex'),
      toolCount: integer('toolCount'),
      fileCount: integer('fileCount'),
      failureCount: integer('failureCount'),
      ...(typeof record.elapsedMs === 'number' &&
      Number.isFinite(record.elapsedMs) &&
      record.elapsedMs >= 0
        ? { elapsedMs: record.elapsedMs }
        : {}),
    });
  }
  return summaries;
}
