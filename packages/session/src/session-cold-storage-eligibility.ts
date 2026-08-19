import type {
  SessionColdStorageConfig,
  SessionColdStorageSkipReason,
  SessionIndexRecord,
} from '@piwin/contracts';
import { isSessionBodyAvailable } from '@piwin/contracts';

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export type ColdStorageEligibilityInput = {
  record: SessionIndexRecord;
  config: SessionColdStorageConfig;
  live: boolean;
  transcriptExists: boolean;
  now?: Date;
  /** Explicit `--session` planning skips the age gate. */
  ignoreAge?: boolean;
};

export type ColdStorageEligibility =
  | { eligible: true }
  | { eligible: false; reason: SessionColdStorageSkipReason };

export function evaluateColdStorageEligibility(
  input: ColdStorageEligibilityInput,
): ColdStorageEligibility {
  if (input.config.enabled !== true) {
    return { eligible: false, reason: 'disabled' };
  }
  if (typeof input.config.packOutputDir !== 'string' || input.config.packOutputDir.trim() === '') {
    return { eligible: false, reason: 'missing-output-dir' };
  }
  if (input.record.kind !== undefined && input.record.kind !== 'main') {
    return { eligible: false, reason: 'not-main' };
  }
  if (input.record.isArchived !== true) {
    return { eligible: false, reason: 'not-archived' };
  }
  if (input.record.isPinned === true) {
    return { eligible: false, reason: 'pinned' };
  }
  if (input.live) {
    return { eligible: false, reason: 'live' };
  }
  if (!isSessionBodyAvailable(input.record)) {
    return { eligible: false, reason: 'not-local' };
  }
  if (!input.transcriptExists) {
    return { eligible: false, reason: 'missing-transcript' };
  }
  if (input.ignoreAge !== true) {
    const archivedAt = Date.parse(input.record.archivedAt ?? input.record.updatedAt);
    const now = (input.now ?? new Date()).getTime();
    const minAge = input.config.minArchivedAgeDays * DAY_MILLISECONDS;
    if (!Number.isFinite(archivedAt) || now - archivedAt < minAge) {
      return { eligible: false, reason: 'too-young' };
    }
  }
  return { eligible: true };
}

export function isMainSessionRecord(record: SessionIndexRecord): boolean {
  return record.kind === undefined || record.kind === 'main';
}
