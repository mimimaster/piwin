/** Pure rolling model-call projection; storage and all-time rollups stay separate. */
import type { SessionScope, UsageCallLog, UsageCallLogEntry, UsageRecord } from '@piwin/contracts';

export type UsageCallLogOptions = {
  scope?: SessionScope;
  projectPath?: string;
  /** Rolling window length in minutes. Default 60. */
  windowMinutes?: number;
  /** Page size, newest first. Default 200. */
  limit?: number;
  /** Zero-based row offset inside the window, for paging. Default 0. */
  offset?: number;
  /** Window end; defaults to now. Injectable so tests stay deterministic. */
  now?: Date;
  /** Detailed backend requests replace that backend session's turn rows in this view only. */
  requestRecords?: readonly UsageRecord[];
};

const DEFAULT_CALL_LOG_WINDOW_MINUTES = 60;
const DEFAULT_CALL_LOG_LIMIT = 200;

/**
 * One page of the rolling window of individual calls, newest first.
 *
 * The ledger is append-only and never rewritten, so "keep the last hour" is a
 * read-side window rather than a retention policy: history stays intact for
 * the all-time rollups while this view stays small. Paging is offset-based:
 * the window is bounded, so the whole ordering is already in memory and a
 * cursor would buy nothing over a slice.
 */
export function computeUsageCallLog(
  records: readonly UsageRecord[],
  options?: UsageCallLogOptions,
): UsageCallLog {
  const windowMinutes = clampInteger(
    options?.windowMinutes ?? DEFAULT_CALL_LOG_WINDOW_MINUTES,
    1,
    1440,
  );
  const limit = clampInteger(options?.limit ?? DEFAULT_CALL_LOG_LIMIT, 1, 1000);
  const requestedOffset = clampInteger(options?.offset ?? 0, 0, Number.MAX_SAFE_INTEGER);
  const to = options?.now ?? new Date();
  const from = new Date(to.getTime() - windowMinutes * 60_000);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const details = (options?.requestRecords ?? []).filter((record) => {
    const recordedMs = Date.parse(record.recordedAt);
    return recordedMs >= from.getTime() && recordedMs <= to.getTime();
  });
  const detailedSessions = new Set(details.map((record) => record.sessionId));
  const combined = [...records.filter((record) => !detailedSessions.has(record.sessionId)), ...details];

  const seenMeasurementIds = new Set<string>();
  const inWindow: UsageRecord[] = [];
  for (const record of combined) {
    if (!matchesUsageScope(record, options?.scope, options?.projectPath)) continue;
    if (record.recordedAt < fromIso) continue;
    if (record.measurementId !== undefined) {
      if (seenMeasurementIds.has(record.measurementId)) continue;
      seenMeasurementIds.add(record.measurementId);
    }
    inWindow.push(record);
  }

  // Ledger order is append order, which is not guaranteed to be chronological
  // once several sessions write concurrently; sort before truncating.
  inWindow.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  // Rows age out of the window between polls, so an offset the client held
  // from a previous page can now be past the end. Land on the last page
  // instead of returning an empty one.
  const offset =
    inWindow.length === 0 ? 0 : Math.min(requestedOffset, lastPageOffset(inWindow.length, limit));
  const entries = inWindow.slice(offset, offset + limit).map(toCallLogEntry);

  return {
    windowMinutes,
    from: fromIso,
    to: toIso,
    entries,
    offset,
    limit,
    totalInWindow: inWindow.length,
    truncated: inWindow.length > entries.length,
  };
}

function lastPageOffset(total: number, limit: number): number {
  return Math.max(0, Math.floor((total - 1) / limit) * limit);
}

function toCallLogEntry(record: UsageRecord): UsageCallLogEntry {
  const entry: UsageCallLogEntry = {
    id: record.measurementId ?? `${record.sessionId}:${record.recordedAt}:${record.totalTokens}`,
    recordedAt: record.recordedAt,
    sessionId: record.sessionId,
    projectPath: record.projectPath,
    providerId: normalizeProviderId(record.providerId),
    modelId: record.modelId ?? null,
    promptTokens: record.promptTokens ?? 0,
    completionTokens: record.completionTokens ?? 0,
    cacheReadTokens: record.cacheReadTokens ?? 0,
    cacheWriteTokens: record.cacheWriteTokens ?? 0,
    totalTokens: record.totalTokens,
    source: record.source,
  };
  if (record.thinkingLevel !== undefined) {
    entry.thinkingLevel = record.thinkingLevel;
  }
  if (typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)) {
    entry.durationMs = record.durationMs;
  }
  if (typeof record.firstTokenMs === 'number' && Number.isFinite(record.firstTokenMs)) {
    entry.firstTokenMs = record.firstTokenMs;
  }
  if (record.success !== undefined) {
    entry.success = record.success;
  }
  if (record.timingScope !== undefined) entry.timingScope = record.timingScope;
  return entry;
}

function matchesUsageScope(
  record: UsageRecord,
  scope: SessionScope | undefined,
  projectPath: string | undefined,
): boolean {
  if (scope) {
    if (scope.kind === 'general') {
      return record.projectPath === null || record.projectPath === '';
    }
    return record.projectPath === scope.projectPath;
  }
  if (projectPath !== undefined) {
    return record.projectPath === projectPath;
  }
  return true;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}


export function normalizeProviderId(providerId: string | undefined): string | null {
  const normalized = providerId?.trim();
  return normalized ? normalized : null;
}

