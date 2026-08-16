import { describe, expect, it, vi } from 'vitest';
import type { IngestionJob } from '@piwin/contracts';
import { isIndexJobReady, waitForDoccardsIndexJob } from './doccards-index-job';

function job(status: IngestionJob['status']): IngestionJob {
  return {
    id: 'ing_1',
    folderKey: 'abcd',
    workspaceName: 'docs',
    folderPath: '/docs',
    includeFiles: [],
    status,
    totalFiles: 1,
    completedFiles: status === 'RUNNING' ? 0 : 1,
    failedFiles: 0,
    skippedUnsupported: 0,
    stageCounts: { parsing: 0, chunking: 0, embedding: 0, indexing: 0 },
    warnings: [],
  };
}

describe('waitForDoccardsIndexJob', () => {
  it('returns when the job becomes COMPLETED_DEGRADED', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: { job: job('RUNNING') } })
      .mockResolvedValueOnce({ success: true, data: { job: job('COMPLETED_DEGRADED') } });
    const result = await waitForDoccardsIndexJob(request, '/docs');
    expect(result.status).toBe('COMPLETED_DEGRADED');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('treats COMPLETED as ready and FAILED as not', () => {
    expect(isIndexJobReady(job('COMPLETED'))).toBe(true);
    expect(isIndexJobReady(job('FAILED'))).toBe(false);
    expect(isIndexJobReady(null)).toBe(false);
  });
});
