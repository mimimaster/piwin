import { describe, expect, it } from 'vitest';
import { isCronDue } from './cron-store.js';
import type { CronJob } from '@piwin/contracts';

function job(partial: Partial<CronJob>): CronJob {
  return {
    id: 'j1',
    name: 't',
    enabled: true,
    schedule: 'every:1m',
    type: 'prompt',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('isCronDue', () => {
  it('fires when never run for every:1m', () => {
    expect(isCronDue(job({}), new Date())).toBe(true);
  });

  it('does not fire when disabled', () => {
    expect(isCronDue(job({ enabled: false }), new Date())).toBe(false);
  });

  it('respects interval', () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 10_000).toISOString();
    expect(isCronDue(job({ lastRunAt: recent }), now)).toBe(false);
    const old = new Date(now.getTime() - 120_000).toISOString();
    expect(isCronDue(job({ lastRunAt: old }), now)).toBe(true);
  });
});
