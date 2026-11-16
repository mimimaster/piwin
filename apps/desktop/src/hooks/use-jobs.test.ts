// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { JobRecord } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import { MAX_JOB_LOGS_BY_ID } from '../platform/record-budget';
import { rememberJobLog, retainListedJobLogs, useJobs } from './use-jobs';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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

  it('coalesces concurrent job/list refreshes into at most one initial and one trailing fetch', async () => {
    const previousActEnv = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    const pendingRequests: Array<(value: { success: boolean; data: { jobs: JobRecord[] } }) => void> = [];
    const requestMock = vi.fn(
      () =>
        new Promise<{ success: boolean; data: { jobs: JobRecord[] } }>((resolve) => {
          pendingRequests.push(resolve);
        }),
    );
    const mockHostClient = {
      request: requestMock,
      supportsCommand: () => true,
    } as unknown as HostClient;

    const controllerRef: { current: ReturnType<typeof useJobs> | null } = { current: null };
    function Probe() {
      controllerRef.current = useJobs(mockHostClient, { refreshWhenVisible: false });
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      act(() => {
        root.render(createElement(Probe));
      });
      const activeController = controllerRef.current;
      if (!activeController) {
        throw new Error('expected useJobs controller');
      }

      const promises: Array<Promise<void>> = [];
      act(() => {
        for (let count = 0; count < 5; count += 1) {
          promises.push(activeController.refreshJobs());
        }
      });

      expect(requestMock).toHaveBeenCalledTimes(1);

      const firstJobs = [{ jobId: 'job-first' } as JobRecord];
      const latestJobs = [{ jobId: 'job-latest' } as JobRecord];

      await act(async () => {
        pendingRequests[0]?.({ success: true, data: { jobs: firstJobs } });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(requestMock).toHaveBeenCalledTimes(2);

      await act(async () => {
        pendingRequests[1]?.({ success: true, data: { jobs: latestJobs } });
        await Promise.all(promises);
      });

      expect(requestMock).toHaveBeenCalledTimes(2);
      expect(controllerRef.current?.jobs).toEqual(latestJobs);
    } finally {
      act(() => {
        root.unmount();
      });
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
    }
  });
});
