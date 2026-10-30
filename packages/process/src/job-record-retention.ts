/**
 * Retention policy for the durable JobRecord store.
 *
 * The store exists for host-start reconciliation: it must remember every
 * still-active job (so a restart can mark it `interrupted`) and enough recent
 * terminal history for the registry to revive (it keeps at most 64 terminal
 * entries resident). Anything older is never read again, yet without a bound
 * it is re-serialized on every flush. This module decides which terminal
 * records to drop; it is pure so the policy is testable without disk.
 */

import type { JobRecord } from '@piwin/contracts';
import { isJobTerminal } from '@piwin/contracts';

/** Hard cap on terminal records kept durable. */
export const DEFAULT_MAX_DURABLE_TERMINAL_RECORDS = 500;

/** Terminal records older than this are dropped once above the floor. */
export const DEFAULT_DURABLE_TERMINAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Newest terminal records kept regardless of age. Matches the registry's
 * resident terminal cap, so restart history survives an idle week.
 */
export const DEFAULT_MIN_DURABLE_TERMINAL_RECORDS = 64;

export type JobRecordRetentionPolicy = {
  /** Terminal records kept at most (newest first). */
  maxTerminalRecords: number;
  /** Terminal records ended longer ago than this may be dropped. */
  terminalMaxAgeMs: number;
  /** Newest terminal records kept even when older than `terminalMaxAgeMs`. */
  minTerminalRecords: number;
};

export const DEFAULT_JOB_RECORD_RETENTION: JobRecordRetentionPolicy = {
  maxTerminalRecords: DEFAULT_MAX_DURABLE_TERMINAL_RECORDS,
  terminalMaxAgeMs: DEFAULT_DURABLE_TERMINAL_MAX_AGE_MS,
  minTerminalRecords: DEFAULT_MIN_DURABLE_TERMINAL_RECORDS,
};

/** End time used for ordering; unparseable stamps sort as oldest. */
function terminalTime(record: JobRecord): number {
  const parsed = Date.parse(record.endedAt ?? record.startedAt ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Return the ids of terminal records the policy drops. Non-terminal records
 * are never selected: they are what restart reconciliation depends on.
 */
export function selectPrunableJobRecordIds(
  records: Iterable<JobRecord>,
  policy: JobRecordRetentionPolicy,
  nowMs: number,
): string[] {
  const terminal: Array<{ jobId: string; time: number }> = [];
  for (const record of records) {
    if (isJobTerminal(record.status)) {
      terminal.push({ jobId: record.jobId, time: terminalTime(record) });
    }
  }
  if (terminal.length <= policy.minTerminalRecords) return [];

  terminal.sort((left, right) => right.time - left.time);
  const cutoff = nowMs - policy.terminalMaxAgeMs;
  const prunable: string[] = [];
  terminal.forEach((entry, rank) => {
    const overCap = rank >= policy.maxTerminalRecords;
    const expired = rank >= policy.minTerminalRecords && entry.time < cutoff;
    if (overCap || expired) {
      prunable.push(entry.jobId);
    }
  });
  return prunable;
}
