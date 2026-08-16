/**
 * Async Doc Cards ingestion job shell (P1).
 * Still runs the existing FolderRag.indexFolder implementation.
 */
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { HostPush, IngestionJob, IngestionJobStatus } from '@piwin/contracts';
import { canonicalizeFolderPath, folderKey, type FolderRag } from '@piwin/doc-rag';

export type DoccardsIngestionRegistry = {
  startIndex: (input: {
    folderPath: string;
    includeFiles?: string[];
    rag: FolderRag;
    push?: (message: HostPush) => void;
    isGenerationRunning?: (folderKey: string) => boolean;
  }) => Promise<{ accepted: { jobId: string; status: 'PENDING' | 'RUNNING' } } | { error: string }>;
  status: (folderPath: string) => Promise<IngestionJob | undefined>;
  cancel: (folderPath: string) => Promise<IngestionJob | { error: string }>;
  isRunning: (folderKey: string) => boolean;
};

export function createDoccardsIngestionRegistry(): DoccardsIngestionRegistry {
  const byFolder = new Map<string, IngestionJob>();
  const running = new Map<string, { abort: AbortController }>();

  function emit(push: ((message: HostPush) => void) | undefined, job: IngestionJob, terminal: boolean): void {
    if (!push) return;
    push(
      terminal
        ? { type: 'doccards/index-terminal', job }
        : { type: 'doccards/index-progress', job },
    );
  }

  return {
    isRunning(folderKeyValue) {
      const job = byFolder.get(folderKeyValue);
      return job?.status === 'PENDING' || job?.status === 'RUNNING';
    },

    async startIndex(input) {
      const canonical = await canonicalizeFolderPath(input.folderPath);
      if (!canonical) {
        return { error: `Folder not found: ${input.folderPath}` };
      }
      const key = folderKey(canonical);
      const existing = byFolder.get(key);
      if (existing?.status === 'PENDING' || existing?.status === 'RUNNING') {
        return { error: 'INDEX_RUNNING' };
      }
      if (input.isGenerationRunning?.(key)) {
        return { error: 'GENERATION_RUNNING' };
      }
      const now = new Date().toISOString();
      const job: IngestionJob = {
        id: `ing_${randomUUID()}`,
        folderKey: key,
        workspaceName: basename(canonical),
        folderPath: canonical,
        includeFiles: input.includeFiles ?? [],
        status: 'RUNNING',
        totalFiles: input.includeFiles?.length ?? 0,
        completedFiles: 0,
        failedFiles: 0,
        skippedUnsupported: 0,
        stageCounts: { parsing: 0, chunking: 0, embedding: 0, indexing: 0 },
        warnings: [],
        startedAt: now,
      };
      byFolder.set(key, job);
      const abort = new AbortController();
      running.set(key, { abort });
      emit(input.push, job, false);

      void (async () => {
        try {
          const result = await input.rag.indexFolder(canonical, {
            ...(input.includeFiles && input.includeFiles.length > 0
              ? { includeFiles: input.includeFiles }
              : {}),
            signal: abort.signal,
            onProgress: (update) => {
              const current = byFolder.get(key);
              if (!current || current.id !== job.id || current.status !== 'RUNNING') return;
              const next: IngestionJob = {
                ...current,
                completedFiles: update.completedFiles,
                totalFiles: Math.max(current.totalFiles, update.totalFiles),
                stageCounts: {
                  ...current.stageCounts,
                  [update.stage]: (current.stageCounts[update.stage] ?? 0) + 1,
                },
              };
              byFolder.set(key, next);
              emit(input.push, next, false);
            },
          });
          const current = byFolder.get(key);
          if (!current || current.id !== job.id) return;
          if (current.status === 'CANCELED') return;
          const failedFiles = result.failed ?? 0;
          const terminalStatus: IngestionJobStatus =
            failedFiles > 0
              ? 'FAILED'
              : result.degraded
                ? 'COMPLETED_DEGRADED'
                : 'COMPLETED';
          const finished: IngestionJob = {
            ...current,
            status: abort.signal.aborted ? 'CANCELED' : terminalStatus,
            completedFiles: result.indexed,
            totalFiles: Math.max(current.totalFiles, result.indexed + result.skipped + failedFiles),
            failedFiles,
            warnings: result.warnings.map((message) => ({
              file: '',
              code: 'INDEX_WARNING',
              message,
            })),
            completedAt: new Date().toISOString(),
          };
          byFolder.set(key, finished);
          running.delete(key);
          emit(input.push, finished, true);
        } catch (error) {
          const current = byFolder.get(key);
          if (!current || current.id !== job.id) return;
          const finished: IngestionJob = {
            ...current,
            status: abort.signal.aborted ? 'CANCELED' : 'FAILED',
            warnings: [
              ...current.warnings,
              {
                file: '',
                code: abort.signal.aborted ? 'CANCELED' : 'INDEX_FAILED',
                message: error instanceof Error ? error.message : String(error),
              },
            ],
            completedAt: new Date().toISOString(),
          };
          byFolder.set(key, finished);
          running.delete(key);
          emit(input.push, finished, true);
        }
      })();

      return { accepted: { jobId: job.id, status: 'RUNNING' } };
    },

    async status(folderPath) {
      const canonical = (await canonicalizeFolderPath(folderPath)) ?? folderPath;
      return byFolder.get(folderKey(canonical));
    },

    async cancel(folderPath) {
      const canonical = (await canonicalizeFolderPath(folderPath)) ?? folderPath;
      const key = folderKey(canonical);
      const job = byFolder.get(key);
      if (!job || (job.status !== 'PENDING' && job.status !== 'RUNNING')) {
        return { error: 'INDEX_NOT_READY' };
      }
      running.get(key)?.abort.abort();
      const canceled: IngestionJob = {
        ...job,
        status: 'CANCELED',
        completedAt: new Date().toISOString(),
      };
      byFolder.set(key, canceled);
      running.delete(key);
      return canceled;
    },
  };
}
