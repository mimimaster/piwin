/**
 * CE-SUB-ORCH: persisted run manifest for subagent batch orchestration.
 *
 * The run store is the durable record of a batch run: runId, parent session,
 * task graph, runtime snapshots, failure policy, workspace leases, and the
 * three orthogonal state axes per task. On host restart, the orchestrator
 * reconciles any `running` task without a live child into a recoverable
 * failed/interrupted state and retains its worktree.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SubagentBatchRequest,
  SubagentFailurePolicy,
  SubagentProcessPolicy,
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
  processPolicy: SubagentProcessPolicy;
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
      processPolicy: request.processPolicy ?? 'required',
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

  async function setStatus(
    runId: string,
    status: SubagentRunManifest['status'],
  ): Promise<void> {
    const manifest = await loadManifest(runId);
    if (!manifest) return;
    manifest.status = status;
    await saveManifest(manifest);
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
    reconcile,
  };
}

export type SubagentRunStore = ReturnType<typeof createSubagentRunStore>;
