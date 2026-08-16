import type { HostResponse, IngestionJob } from '@piwin/contracts';

export type DoccardsIndexRequest = (command: {
  type: 'doccards/index-folder' | 'doccards/index-status';
  folderPath: string;
  includeFiles?: string[];
}) => Promise<HostResponse>;

const TERMINAL = new Set(['COMPLETED', 'COMPLETED_DEGRADED', 'FAILED', 'CANCELED']);

export async function waitForDoccardsIndexJob(
  request: DoccardsIndexRequest,
  folderPath: string,
  signal?: AbortSignal,
): Promise<IngestionJob> {
  for (;;) {
    if (signal?.aborted) {
      throw new Error('INDEX_CANCELED');
    }
    const response = await request({ type: 'doccards/index-status', folderPath });
    if (!response.success) {
      throw new Error(response.error);
    }
    const job = (response.data as { job?: IngestionJob | null }).job;
    if (job && TERMINAL.has(job.status)) {
      if (job.status === 'FAILED' || job.status === 'CANCELED') {
        throw new Error(job.warnings[0]?.message ?? job.status);
      }
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** @deprecated Prefer selectedDocumentsReady(); leftover for existing tests. */
export function isIndexJobReady(job: IngestionJob | null): boolean {
  return job?.status === 'COMPLETED' || job?.status === 'COMPLETED_DEGRADED';
}
