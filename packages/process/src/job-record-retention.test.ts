import { describe, expect, it } from 'vitest';
import type { JobRecord, JobStatus } from '@piwin/contracts';

import {
  DEFAULT_JOB_RECORD_RETENTION,
  selectPrunableJobRecordIds,
  type JobRecordRetentionPolicy,
} from './job-record-retention.js';

const NOW_MS = Date.parse('2026-10-24T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function makeRecord(jobId: string, status: JobStatus, endedAgoMs?: number): JobRecord {
  return {
    jobId,
    kind: 'command',
    lifetime: 'host',
    command: 'echo',
    argv: [],
    cwd: '/tmp',
    status,
    startedAt: new Date(NOW_MS - 30 * DAY_MS).toISOString(),
    ...(endedAgoMs !== undefined ? { endedAt: new Date(NOW_MS - endedAgoMs).toISOString() } : {}),
    latestLogCursor: 0,
  };
}

/** `count` terminal records ended 1s, 2s, … ago (`t-0` newest). */
function terminalRecords(count: number, status: JobStatus = 'exited'): JobRecord[] {
  return Array.from({ length: count }, (_, index) =>
    makeRecord(`t-${index}`, status, (index + 1) * 1000),
  );
}

const SMALL_POLICY: JobRecordRetentionPolicy = {
  maxTerminalRecords: 5,
  terminalMaxAgeMs: 7 * DAY_MS,
  minTerminalRecords: 2,
};

describe('selectPrunableJobRecordIds', () => {
  it('keeps everything within the limits', () => {
    expect(selectPrunableJobRecordIds(terminalRecords(5), SMALL_POLICY, NOW_MS)).toEqual([]);
  });

  it('drops the oldest terminal records beyond the count cap', () => {
    const pruned = selectPrunableJobRecordIds(terminalRecords(8), SMALL_POLICY, NOW_MS);
    expect(pruned.sort()).toEqual(['t-5', 't-6', 't-7']);
  });

  it('never drops non-terminal records, even when old or over the cap', () => {
    const active: JobRecord[] = (['starting', 'running', 'ready', 'stopping'] as const).map(
      (status) => makeRecord(`active-${status}`, status, 400 * DAY_MS),
    );
    const records = [...active, ...terminalRecords(8)];
    const pruned = selectPrunableJobRecordIds(records, SMALL_POLICY, NOW_MS);
    expect(pruned.some((jobId) => jobId.startsWith('active-'))).toBe(false);
    expect(pruned).toHaveLength(3);
  });

  it('treats every terminal status alike', () => {
    const statuses: JobStatus[] = ['exited', 'failed', 'cancelled', 'interrupted'];
    const records = Array.from({ length: 8 }, (_, index) =>
      makeRecord(`t-${index}`, statuses[index % statuses.length] ?? 'exited', (index + 1) * 1000),
    );
    const pruned = selectPrunableJobRecordIds(records, SMALL_POLICY, NOW_MS);
    expect(pruned.sort()).toEqual(['t-5', 't-6', 't-7']);
  });

  it('drops expired records but keeps the newest floor regardless of age', () => {
    const records = [
      makeRecord('fresh', 'exited', DAY_MS),
      makeRecord('old-1', 'exited', 10 * DAY_MS),
      makeRecord('old-2', 'failed', 11 * DAY_MS),
      makeRecord('old-3', 'cancelled', 12 * DAY_MS),
    ];
    // Floor 2: `fresh` + `old-1` stay; older expired ones go.
    const pruned = selectPrunableJobRecordIds(records, SMALL_POLICY, NOW_MS);
    expect(pruned.sort()).toEqual(['old-2', 'old-3']);
  });

  it('keeps an idle-period history at the floor', () => {
    const records = [
      makeRecord('old-1', 'exited', 30 * DAY_MS),
      makeRecord('old-2', 'exited', 31 * DAY_MS),
    ];
    expect(selectPrunableJobRecordIds(records, SMALL_POLICY, NOW_MS)).toEqual([]);
  });

  it('orders by endedAt, falling back to startedAt; unparseable times sort oldest', () => {
    const noEnd = { ...makeRecord('no-end', 'exited'), startedAt: new Date(NOW_MS - 500).toISOString() };
    const garbage = { ...makeRecord('garbage', 'exited'), startedAt: 'not-a-date' };
    const records = [...terminalRecords(5), noEnd, garbage];
    const pruned = selectPrunableJobRecordIds(records, SMALL_POLICY, NOW_MS);
    // `no-end` started 0.5s ago, newer than every t-*; t-4 and garbage go.
    expect(pruned.sort()).toEqual(['garbage', 't-4']);
  });

  it('respects the default 500-record cap', () => {
    const records = terminalRecords(DEFAULT_JOB_RECORD_RETENTION.maxTerminalRecords + 10);
    const pruned = selectPrunableJobRecordIds(records, DEFAULT_JOB_RECORD_RETENTION, NOW_MS);
    expect(pruned).toHaveLength(10);
    expect(pruned).not.toContain('t-0');
    expect(pruned).toContain(`t-${DEFAULT_JOB_RECORD_RETENTION.maxTerminalRecords + 9}`);
  });
});
