import { describe, expect, it } from 'vitest';
import { MAX_JOB_LOGS_BY_ID } from '../record-budget';
import { rememberJobLog, retainListedJobLogs } from './use-jobs';

describe('job log residency', () => {
  it('caps per-job text and the number of remembered job ids', () => {
    const oversized = rememberJobLog({}, 'job-1', 'x'.repeat(600_000));
    expect(oversized['job-1']?.startsWith('[earlier job output truncated]\n')).toBe(true);
    expect(oversized['job-1']?.length).toBeLessThan(600_000);

    let cache: Record<string, string> = {};
    for (let index = 0; index < MAX_JOB_LOGS_BY_ID + 4; index += 1) {
      cache = rememberJobLog(cache, `job-${index}`, `log-${index}`);
    }
    expect(Object.keys(cache)).toHaveLength(MAX_JOB_LOGS_BY_ID);
    expect(cache['job-0']).toBeUndefined();
    expect(cache[`job-${MAX_JOB_LOGS_BY_ID + 3}`]).toBe(`log-${MAX_JOB_LOGS_BY_ID + 3}`);
  });

  it('drops logs for jobs that left the listed set', () => {
    const next = retainListedJobLogs({ keep: 'a', gone: 'b' }, [{ jobId: 'keep' }]);
    expect(next).toEqual({ keep: 'a' });
  });
});
