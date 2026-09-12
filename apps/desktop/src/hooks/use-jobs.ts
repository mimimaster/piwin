import { useCallback, useEffect, useState } from 'react';
import type { JobRecord } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import { MAX_JOB_LOGS_BY_ID, putRecordLru, retainRecordKeys } from '../record-budget';

export function useJobs(
  hostClient: HostClient,
  options: { refreshWhenVisible: boolean; sessionId?: string | null },
) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [jobLogsById, setJobLogsById] = useState<Record<string, string>>({});

  const refreshJobs = useCallback(async (): Promise<void> => {
    if (hostClient.supportsCommand?.('job/list') === false) {
      return;
    }
    const response = await hostClient.request({ type: 'job/list' });
    if (!response.success) {
      return;
    }
    const listedJobs = (response.data as { jobs?: JobRecord[] } | undefined)?.jobs ?? [];
    setJobs(listedJobs);
    setJobLogsById((current) => retainListedJobLogs(current, listedJobs));
  }, [hostClient]);

  const loadJobLogs = useCallback(
    async (jobId: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'job/logs',
        input: { jobId },
      });
      if (!response.success) {
        return;
      }
      const chunks =
        (response.data as { chunks?: Array<{ text: string }> } | undefined)?.chunks ?? [];
      const text = chunks.map((chunk) => chunk.text).join('');
      setJobLogsById((current) => rememberJobLog(current, jobId, text));
    },
    [hostClient],
  );

  const stopJob = useCallback(
    async (jobId: string): Promise<void> => {
      const response = await hostClient.request({ type: 'job/stop', jobId });
      if (response.success) {
        await refreshJobs();
        await loadJobLogs(jobId);
      }
    },
    [hostClient, refreshJobs, loadJobLogs],
  );

  const appendJobLog = useCallback((jobId: string, text: string): void => {
    setJobLogsById((current) => rememberJobLog(current, jobId, `${current[jobId] ?? ''}${text}`));
  }, []);

  useEffect(() => {
    if (options.refreshWhenVisible) {
      void refreshJobs();
    }
  }, [options.refreshWhenVisible, options.sessionId, refreshJobs]);

  return {
    jobs,
    jobLogsById,
    refreshJobs,
    loadJobLogs,
    stopJob,
    appendJobLog,
  };
}

export function rememberJobLog(
  current: Record<string, string>,
  jobId: string,
  text: string,
): Record<string, string> {
  return putRecordLru(current, jobId, limitJobLog(text), MAX_JOB_LOGS_BY_ID);
}

export function retainListedJobLogs(
  current: Record<string, string>,
  jobs: readonly Pick<JobRecord, 'jobId'>[],
): Record<string, string> {
  return retainRecordKeys(
    current,
    jobs.map((job) => job.jobId),
  );
}

function limitJobLog(text: string): string {
  const MAX_JOB_LOG_BYTES = 512_000;
  if (text.length <= MAX_JOB_LOG_BYTES) {
    return text;
  }
  return `[earlier job output truncated]\n${text.slice(-MAX_JOB_LOG_BYTES)}`;
}
