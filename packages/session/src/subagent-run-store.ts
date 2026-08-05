/**
 * CE-SUB-ORCH: persisted run manifest for subagent batch orchestration.
 *
 * The run store is the durable record of a batch run: runId, parent session,
 * task graph, runtime snapshots, failure policy, workspace leases, and the
 * three orthogonal state axes per task. On host restart, the orchestrator
 * reconciles any `running` task without a live child into a recoverable
 * failed/interrupted state and retains its worktree.
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import type {
  SubagentBatchRequest,
  SubagentFailurePolicy,
  SubagentRuntimeSnapshot,
  SubagentTaskResult,
  SubagentWorkspaceLease,
} from '@piwin/contracts';

export type SubagentRunManifest = {
  runId: string;
  parentSessionId: string;
  createdAt: string;
  updatedAt: string;
  /** Snapshot of the batch request (task specs without transient fields). */
  tasks: Array<{
    id: string;
    task: string;
    profileId?: string;
    dependsOn?: string[];
    parallelGroup?: string;
  }>;
  maxConcurrency: number;
  failurePolicy: SubagentFailurePolicy;
  /** Per-task runtime snapshot captured at dispatch time. */
  snapshots: Record<string, SubagentRuntimeSnapshot>;
  /** Per-task workspace lease allocated at dispatch time. */
  leases: Record<string, SubagentWorkspaceLease>;
  /** Per-task results (updated after each terminal event). */
  results: Record<string, SubagentTaskResult>;
  /** Batch-level status. */
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration';
};

export type SubagentRunStoreOptions = {
  /** Directory where run manifests are persisted (one JSON file per run). */
  runsDir: string;
};

export function createSubagentRunStore(options: SubagentRunStoreOptions) {
  const runsDir = options.runsDir;

  function runPath(runId: string): string {
    return join(runsDir, `${runId}.json`);
  }

  async function ensureDir(): Promise<void> {
    await mkdir(runsDir, { recursive: true });
  }

  async function createManifest(
    runId: string,
    request: SubagentBatchRequest,
  ): Promise<SubagentRunManifest> {
    await ensureDir();
    const now = new Date().toISOString();
    const manifest: SubagentRunManifest = {
      runId,
      parentSessionId: request.parentSessionId,
      createdAt: now,
      updatedAt: now,
      tasks: request.tasks.map((t) => ({
        id: t.id,
        task: t.task,
        ...(t.profileId ? { profileId: t.profileId } : {}),
        ...(t.dependsOn ? { dependsOn: [...t.dependsOn] } : {}),
        ...(t.parallelGroup ? { parallelGroup: t.parallelGroup } : {}),
      })),
      maxConcurrency: request.maxConcurrency ?? 4,
      failurePolicy: request.failurePolicy ?? 'continue',
      snapshots: {},
      leases: {},
      results: {},
      status: 'running',
    };
    await writeFile(runPath(runId), JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }

  async function loadManifest(runId: string): Promise<SubagentRunManifest | undefined> {
    try {
      const raw = await readFile(runPath(runId), 'utf8');
      return JSON.parse(raw) as SubagentRunManifest;
    } catch {
      return undefined;
    }
  }

  async function saveManifest(manifest: SubagentRunManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    await ensureDir();
    await writeFile(runPath(manifest.runId), JSON.stringify(manifest, null, 2), 'utf8');
  }

  async function recordSnapshot(
    runId: string,
    taskId: string,
    snapshot: SubagentRuntimeSnapshot,
  ): Promise<void> {
    const manifest = await loadManifest(runId);
    if (!manifest) return;
    manifest.snapshots[taskId] = snapshot;
    await saveManifest(manifest);
  }

  async function recordLease(
    runId: string,
    taskId: string,
    lease: SubagentWorkspaceLease,
  ): Promise<void> {
    const manifest = await loadManifest(runId);
    if (!manifest) return;
    manifest.leases[taskId] = lease;
    await saveManifest(manifest);
  }

  async function recordResult(
    runId: string,
    taskId: string,
    result: SubagentTaskResult,
  ): Promise<void> {
    const manifest = await loadManifest(runId);
    if (!manifest) return;
    manifest.results[taskId] = result;
    await saveManifest(manifest);
  }

  async function setStatus(runId: string, status: SubagentRunManifest['status']): Promise<void> {
    const manifest = await loadManifest(runId);
    if (!manifest) return;
    manifest.status = status;
    await saveManifest(manifest);
  }

  async function requestCancel(runId: string): Promise<boolean> {
    const manifest = await loadManifest(runId);
    if (!manifest || manifest.status !== 'running') return false;
    await ensureDir();
    await writeFile(join(runsDir, `${runId}.cancel`), new Date().toISOString(), 'utf8');
    return true;
  }

  async function isCancelRequested(runId: string): Promise<boolean> {
    try {
      await readFile(join(runsDir, `${runId}.cancel`), 'utf8');
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Wait for a persisted cancellation marker without polling the filesystem.
   * The second read after installing the watcher closes the create-between-
   * check-and-watch race; the initial read handles markers that predate this
   * host process.
   */
  async function waitForCancel(runId: string, signal?: AbortSignal): Promise<boolean> {
    if (await isCancelRequested(runId)) return true;
    await ensureDir();
    if (signal?.aborted) return false;

    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      let closeWatcher: (() => void) | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = (): void => {
        closeWatcher?.();
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      };

      const settle = (value: boolean): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      onAbort = (): void => settle(false);
      const checkMarker = async (): Promise<void> => {
        if (settled) return;
        try {
          if (await isCancelRequested(runId)) settle(true);
        } catch (error) {
          fail(error);
        }
      };

      try {
        const watcher = watch(runsDir, { persistent: false }, (_eventType, filename) => {
          if (settled || filename === null) return;
          if (filename.toString() !== `${runId}.cancel`) return;
          // Re-read the marker so a directory event cannot acknowledge a
          // transient or unrelated filesystem notification.
          void checkMarker();
        });
        closeWatcher = () => watcher.close();
        watcher.on('error', fail);
      } catch (error) {
        fail(error);
        return;
      }

      if (signal && onAbort) signal.addEventListener('abort', onAbort, { once: true });
      // Re-check after the watcher is live to close the write-before-watch
      // race without introducing a timer or polling loop.
      void checkMarker();
    });
  }

  async function clearCancelRequest(runId: string): Promise<void> {
    try {
      await unlink(join(runsDir, `${runId}.cancel`));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  /**
   * Reconcile a manifest after host restart: any task with a `running`
   * execution status but no live child is marked failed (interrupted).
   * Worktree leases are preserved for inspection.
   */
  async function reconcile(
    runId: string,
    isChildLive: (childSessionId: string) => boolean,
  ): Promise<SubagentRunManifest | undefined> {
    const manifest = await loadManifest(runId);
    if (!manifest || manifest.status !== 'running') return manifest;
    let changed = false;
    for (const [taskId, result] of Object.entries(manifest.results)) {
      if (
        result.executionStatus === 'running' &&
        result.childSessionId &&
        !isChildLive(result.childSessionId)
      ) {
        manifest.results[taskId] = {
          ...result,
          executionStatus: 'failed',
          error: 'interrupted by host restart',
        };
        changed = true;
      }
    }
    if (changed) {
      await saveManifest(manifest);
    }
    return manifest;
  }

  return {
    createManifest,
    loadManifest,
    saveManifest,
    recordSnapshot,
    recordLease,
    recordResult,
    setStatus,
    requestCancel,
    isCancelRequested,
    waitForCancel,
    clearCancelRequest,
    reconcile,
  };
}

export type SubagentRunStore = ReturnType<typeof createSubagentRunStore>;
