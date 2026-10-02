/**
 * Usage ledger store (CE-OBS).
 * Append-only JSONL of billable token turns. Rollups are computed on read so
 * the write path stays a single cheap append and never rewrites history.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  ContextUsageSnapshot,
  SessionScope,
  UsageBucket,
  UsageCallLog,
  UsageModelKeyTotal,
  UsageRecord,
  UsageRollup,
} from '@piwin/contracts';
import { shouldAcceptContextUsage } from '@piwin/contracts';
import { addToUsageBucket, createUsageBucket } from './usage-bucket.js';
import { computeUsageCallLog, normalizeProviderId, type UsageCallLogOptions } from './usage-call-log.js';

export type UsageRollupOptions = {
  scope?: SessionScope;
  projectPath?: string;
  window?: { from?: string; to?: string };
  topSessions?: number;
  /** IANA zone for `byDay` keys; UTC when omitted or unknown. */
  timeZone?: string;
};

/**
 * `YYYY-MM-DD` of an ISO instant in the viewer's zone. A UTC day would put an
 * 07:00 turn in UTC+8 on the previous day's bar. `en-CA` formats as ISO date.
 */
function createDayKeyFormatter(timeZone: string | undefined): (recordedAt: string) => string {
  if (timeZone === undefined) return (recordedAt) => recordedAt.slice(0, 10);
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // Unknown zone name from an older or foreign client: keep UTC days.
    return (recordedAt) => recordedAt.slice(0, 10);
  }
  return (recordedAt) => {
    const instant = new Date(recordedAt);
    return Number.isFinite(instant.getTime()) ? format.format(instant) : recordedAt.slice(0, 10);
  };
}

type LedgerCache = {
  queue: Promise<void>;
  seen: Set<string> | null;
};

const ledgerCaches = new Map<string, LedgerCache>();

function cacheFor(filePath: string): LedgerCache {
  const existing = ledgerCaches.get(filePath);
  if (existing !== undefined) {
    return existing;
  }
  const created: LedgerCache = { queue: Promise.resolve(), seen: null };
  ledgerCaches.set(filePath, created);
  return created;
}

/** Test seam: simulate a process restart after a successful JSONL write. */
export function resetUsageLedgerCaches(): void {
  ledgerCaches.clear();
}

export async function appendUsageRecord(
  filePath: string,
  record: UsageRecord,
): Promise<'inserted' | 'duplicate'> {
  const cache = cacheFor(filePath);
  const pending = cache.queue.then(() => appendUsageRecordLocked(filePath, cache, record));
  cache.queue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

async function appendUsageRecordLocked(
  filePath: string,
  cache: LedgerCache,
  record: UsageRecord,
): Promise<'inserted' | 'duplicate'> {
  if (cache.seen === null) {
    const existing = await loadUsageRecords(filePath);
    cache.seen = new Set(
      existing.flatMap((row) => (row.measurementId !== undefined ? [row.measurementId] : [])),
    );
  }
  if (record.measurementId !== undefined && cache.seen.has(record.measurementId)) {
    return 'duplicate';
  }
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  if (record.measurementId !== undefined) {
    cache.seen.add(record.measurementId);
  }
  return 'inserted';
}

export async function loadUsageRecords(filePath: string): Promise<UsageRecord[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
  const records: UsageRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const record = parsed as Partial<UsageRecord>;
      if (
        typeof record?.sessionId === 'string' &&
        typeof record.totalTokens === 'number' &&
        Number.isFinite(record.totalTokens)
      ) {
        records.push(record as UsageRecord);
      }
    } catch {
      // Corrupt lines are skipped; the ledger is append-only and must not
      // block reads because of one bad entry.
    }
  }
  return records;
}

/**
 * Restore the latest context snapshot for one session from the append-only
 * ledger. Provider/Pi measurements outrank later Host fallback estimates.
 */
export async function readLatestSessionContextUsage(
  filePath: string,
  sessionId: string,
): Promise<ContextUsageSnapshot | null> {
  return selectLatestSessionContextUsage(await loadUsageRecords(filePath), sessionId);
}

export function selectLatestSessionContextUsage(
  records: readonly UsageRecord[],
  sessionId: string,
): ContextUsageSnapshot | null {
  let latest: ContextUsageSnapshot | null = null;
  for (const record of records) {
    if (record.sessionId !== sessionId) {
      continue;
    }
    const candidate = usageRecordToContextSnapshot(record);
    if (shouldAcceptContextUsage(latest, candidate)) {
      latest = candidate;
    }
  }
  return latest;
}

export async function readUsageRollup(
  filePath: string,
  options?: UsageRollupOptions,
): Promise<UsageRollup> {
  const records = await loadUsageRecords(filePath);
  return computeUsageRollup(records, options);
}

export async function readUsageCallLog(
  filePath: string,
  options?: UsageCallLogOptions,
): Promise<UsageCallLog> {
  const records = await loadUsageRecords(filePath);
  return computeUsageCallLog(records, options);
}

/**
 * Pure aggregation over ledger records. Kept pure and unit-testable; the
 * host command layer calls readUsageRollup (load + compute).
 */
export function computeUsageRollup(
  records: UsageRecord[],
  options?: UsageRollupOptions,
): UsageRollup {
  const scope = options?.scope;
  const projectPath = options?.projectPath;
  const windowFrom = options?.window?.from;
  const windowTo = options?.window?.to;
  const topSessions = options?.topSessions ?? 20;
  const dayKeyOf = createDayKeyFormatter(options?.timeZone);

  const seenMeasurementIds = new Set<string>();
  const filtered = records.filter((record) => {
    if (scope) {
      const recordProject = record.projectPath;
      if (scope.kind === 'general') {
        if (recordProject !== null && recordProject !== '') return false;
      } else if (recordProject !== scope.projectPath) {
        return false;
      }
    } else if (projectPath !== undefined) {
      if (record.projectPath !== projectPath) return false;
    }
    if (windowFrom !== undefined && record.recordedAt < windowFrom) return false;
    if (windowTo !== undefined && record.recordedAt > windowTo) return false;
    if (record.measurementId !== undefined) {
      if (seenMeasurementIds.has(record.measurementId)) return false;
      seenMeasurementIds.add(record.measurementId);
    }
    return true;
  });

  const totals = createUsageBucket();
  const byModel: Record<string, UsageBucket> = {};
  const byModelKey = new Map<string, UsageModelKeyTotal>();
  const byDay: Record<string, UsageBucket> = {};
  const bySession = new Map<string, UsageBucket & { firstAt: string; lastAt: string }>();

  for (const record of filtered) {
    addToUsageBucket(totals, record);
    if (record.modelId) {
      let modelBucket = byModel[record.modelId];
      if (!modelBucket) {
        modelBucket = createUsageBucket();
        byModel[record.modelId] = modelBucket;
      }
      addToUsageBucket(modelBucket, record);

      const providerId = normalizeProviderId(record.providerId);
      const modelKey = JSON.stringify([providerId, record.modelId]);
      let modelKeyBucket = byModelKey.get(modelKey);
      if (!modelKeyBucket) {
        modelKeyBucket = {
          providerId,
          modelId: record.modelId,
          ...createUsageBucket(),
        };
        byModelKey.set(modelKey, modelKeyBucket);
      }
      addToUsageBucket(modelKeyBucket, record);
    }
    const day = dayKeyOf(record.recordedAt);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      let dayBucket = byDay[day];
      if (!dayBucket) {
        dayBucket = createUsageBucket();
        byDay[day] = dayBucket;
      }
      addToUsageBucket(dayBucket, record);
    }
    const sessionTotal = bySession.get(record.sessionId) ?? {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      entryCount: 0,
      firstAt: record.recordedAt,
      lastAt: record.recordedAt,
    };
    sessionTotal.promptTokens += record.promptTokens ?? 0;
    sessionTotal.completionTokens += record.completionTokens ?? 0;
    sessionTotal.cacheReadTokens += record.cacheReadTokens ?? 0;
    sessionTotal.cacheWriteTokens += record.cacheWriteTokens ?? 0;
    sessionTotal.totalTokens += record.totalTokens;
    sessionTotal.entryCount += 1;
    if (typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)) {
      sessionTotal.durationMs = (sessionTotal.durationMs ?? 0) + record.durationMs;
      sessionTotal.durationMsCompletionTokens =
        (sessionTotal.durationMsCompletionTokens ?? 0) + (record.completionTokens ?? 0);
    }
    if (record.recordedAt < sessionTotal.firstAt) sessionTotal.firstAt = record.recordedAt;
    if (record.recordedAt > sessionTotal.lastAt) sessionTotal.lastAt = record.recordedAt;
    bySession.set(record.sessionId, sessionTotal);
  }

  const bySessionTotals = [...bySession.entries()]
    .map(([sessionId, meta]) => ({ sessionId, ...meta }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
    .slice(0, topSessions);
  const byModelKeyTotals = [...byModelKey.values()].sort(
    (left, right) => right.totalTokens - left.totalTokens,
  );

  return {
    scope: resolveScope(scope, projectPath),
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.totalTokens,
    entryCount: totals.entryCount,
    sessionCount: bySession.size,
    firstAt: filtered.length > 0 ? firstOf(filtered).recordedAt : null,
    lastAt: filtered.length > 0 ? lastOf(filtered).recordedAt : null,
    byModel,
    byModelKey: byModelKeyTotals,
    byDay,
    bySession: bySessionTotals,
  };
}


function resolveScope(
  scope: SessionScope | undefined,
  projectPath: string | undefined,
): SessionScope | { kind: 'global' } {
  if (scope) return scope;
  if (projectPath !== undefined && projectPath.trim().length > 0) {
    return { kind: 'project', projectPath };
  }
  return { kind: 'global' };
}

function usageRecordToContextSnapshot(record: UsageRecord): ContextUsageSnapshot {
  return {
    sessionId: record.sessionId,
    ...(record.modelId !== undefined ? { modelId: record.modelId } : {}),
    ...(record.promptTokens !== undefined ? { promptTokens: record.promptTokens } : {}),
    ...(record.completionTokens !== undefined ? { completionTokens: record.completionTokens } : {}),
    ...(record.cacheReadTokens !== undefined ? { cacheReadTokens: record.cacheReadTokens } : {}),
    ...(record.cacheWriteTokens !== undefined ? { cacheWriteTokens: record.cacheWriteTokens } : {}),
    totalTokens: record.totalTokens,
    updatedAt: record.recordedAt,
    source: record.source,
  };
}

function firstOf(records: UsageRecord[]): UsageRecord {
  return records.reduce((min, record) => (record.recordedAt < min.recordedAt ? record : min));
}

function lastOf(records: UsageRecord[]): UsageRecord {
  return records.reduce((max, record) => (record.recordedAt > max.recordedAt ? record : max));
}

function isNotFound(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
