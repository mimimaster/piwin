import type { GenerationJob, HostResponse } from '@piwin/contracts';

export type DoccardsGenerateRequest = (command: {
  type: 'doccards/generate' | 'doccards/generation-status';
  folderPath: string;
  includeFiles?: string[];
  topic?: string;
}) => Promise<HostResponse>;

const TERMINAL = new Set(['COMPLETED', 'COMPLETED_DEGRADED', 'FAILED', 'CANCELED']);

export async function runDoccardsGenerate(
  request: DoccardsGenerateRequest,
  input: { folderPath: string; includeFiles?: string[]; topic?: string },
): Promise<GenerationJob> {
  const started = await request({
    type: 'doccards/generate',
    folderPath: input.folderPath,
    ...(input.includeFiles ? { includeFiles: input.includeFiles } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
  });
  if (!started.success) {
    throw new Error(started.error);
  }
  for (;;) {
    const status = await request({
      type: 'doccards/generation-status',
      folderPath: input.folderPath,
    });
    if (!status.success) throw new Error(status.error);
    const job = (status.data as { job?: GenerationJob | null }).job;
    if (job && TERMINAL.has(job.status)) {
      if (job.status === 'FAILED' || job.status === 'CANCELED') {
        throw new Error(job.status);
      }
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
