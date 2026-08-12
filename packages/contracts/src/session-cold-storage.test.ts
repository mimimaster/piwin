import { describe, expect, it } from 'vitest';
import {
  COLD_STORAGE_PLAN_TTL_MS,
  DEFAULT_COLD_STORAGE_MIN_ARCHIVED_AGE_DAYS,
  SESSION_PACK_INVALID,
  SESSION_PACK_STALE,
  SESSION_STORAGE_BUSY,
  SESSION_STORAGE_CONFLICT,
  SessionPackInvalidError,
  SessionPackStaleError,
  SessionStorageBusyError,
  SessionStorageConflictError,
  createDefaultSessionColdStorageConfig,
} from './index.js';

describe('session cold storage contracts', () => {
  it('defaults to disabled with a 30-day planner age gate', () => {
    expect(createDefaultSessionColdStorageConfig()).toEqual({
      enabled: false,
      minArchivedAgeDays: DEFAULT_COLD_STORAGE_MIN_ARCHIVED_AGE_DAYS,
    });
    expect(DEFAULT_COLD_STORAGE_MIN_ARCHIVED_AGE_DAYS).toBe(30);
    expect(COLD_STORAGE_PLAN_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('exposes stable storage mutation error codes', () => {
    expect(new SessionStorageBusyError('ses_1').code).toBe(SESSION_STORAGE_BUSY);
    expect(new SessionStorageConflictError('ses_1', 'already has a local body').code).toBe(
      SESSION_STORAGE_CONFLICT,
    );
    expect(new SessionPackStaleError('ses_1').code).toBe(SESSION_PACK_STALE);
    expect(new SessionPackInvalidError('sidecar missing').code).toBe(SESSION_PACK_INVALID);
    expect(new SessionStorageBusyError('ses_1').retryable).toBe(true);
  });
});
