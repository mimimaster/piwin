/**
 * Give an undecided write-subagent result a terminal state.
 *
 * A candidate result stays `retained` until the lead applies or discards it,
 * and the lead has no tool to discard. A lead that finishes the work another
 * way (copying the files, committing on its own branch) therefore leaves the
 * result pending forever: GC keeps it as `pending-integration`, the batch
 * stays `needs-integration`, and a persistent sidekick lane keeps "continuing"
 * from a base the lead has left. After a long quiet period the result is
 * discarded through the same path as a manual discard, which also releases the
 * snapshot ref that keeps its objects alive.
 */
import { SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS } from '@piwin/contracts';
import { runGitCommand } from '@piwin/git';
import type { SubagentRunManifest } from '@piwin/session';

/** Same horizon as the leftover-worktree GC, so both clean up on one schedule. */
export const SUBAGENT_RESULT_EXPIRY_MS = SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS;

export type ExpiredSubagentResult = {
  runId: string;
  taskId: string;
  childSessionId: string;
  frozenAtMs: number;
};

/**
 * Pure selection. `frozenAtMs` is the moment the result was frozen, never the
 * manifest's `updatedAt`: startup reconciliation rewrites every manifest, so
 * that stamp restarts the clock on each Host launch.
 */
export function selectExpiredSubagentResults(input: {
  manifests: readonly SubagentRunManifest[];
  nowMs: number;
  ttlMs: number;
  isRunActive: (runId: string) => boolean;
  frozenAtMs: (manifest: SubagentRunManifest, taskId: string) => number;
}): ExpiredSubagentResult[] {
  const expired: ExpiredSubagentResult[] = [];
  for (const manifest of input.manifests) {
    if (manifest.status === 'running' || input.isRunActive(manifest.runId)) continue;
    for (const task of manifest.tasks) {
      const result = manifest.results[task.id];
      const lease = manifest.leases[task.id];
      if (result === undefined || lease?.mode !== 'worktree') continue;
      if (result.executionStatus !== 'completed' || result.integrationStatus !== 'retained') continue;
      // An explicit "keep this copy" is the user's call, not an oversight.
      if (task.retainWorktree === true) continue;
      if (result.childSessionId === undefined) continue;
      const frozenAtMs = input.frozenAtMs(manifest, task.id);
      if (input.nowMs - frozenAtMs < input.ttlMs) continue;
      expired.push({
        runId: manifest.runId,
        taskId: task.id,
        childSessionId: result.childSessionId,
        frozenAtMs,
      });
    }
  }
  return expired;
}

export type ExpireStaleSubagentResultsPorts = {
  listManifests: () => Promise<readonly SubagentRunManifest[]>;
  isRunActive: (runId: string) => boolean;
  /** Commit time of a frozen snapshot, or undefined when it cannot be read. */
  readSnapshotTimeMs: (repoPath: string, commit: string) => Promise<number | undefined>;
  /** Same operation as a manual discard, addressed to one run's result. */
  discard: (entry: { childSessionId: string; runId: string; taskId: string }) => Promise<void>;
  warn: (message: string) => void;
  now?: () => number;
  ttlMs?: number;
};

export async function expireStaleSubagentResults(
  ports: ExpireStaleSubagentResultsPorts,
): Promise<{ discarded: number; failed: number }> {
  const manifests = await ports.listManifests();
  // The snapshot commit time is read once per candidate before the pure pass,
  // because the pass itself is synchronous.
  const frozenAt = new Map<string, number>();
  for (const manifest of manifests) {
    for (const task of manifest.tasks) {
      const result = manifest.results[task.id];
      const lease = manifest.leases[task.id];
      if (result?.gitSnapshot === undefined || lease?.mode !== 'worktree') continue;
      const time = await ports.readSnapshotTimeMs(lease.parentRepoPath, result.gitSnapshot.commit);
      if (time !== undefined) frozenAt.set(`${manifest.runId}/${task.id}`, time);
    }
  }
  const expired = selectExpiredSubagentResults({
    manifests,
    nowMs: (ports.now ?? Date.now)(),
    ttlMs: ports.ttlMs ?? SUBAGENT_RESULT_EXPIRY_MS,
    isRunActive: ports.isRunActive,
    // No readable snapshot: fall back to when the run was created, which is
    // older than the freeze and so errs toward settling, never toward keeping.
    frozenAtMs: (manifest, taskId) =>
      frozenAt.get(`${manifest.runId}/${taskId}`) ?? (Date.parse(manifest.createdAt) || 0),
  });

  let discarded = 0;
  let failed = 0;
  for (const entry of expired) {
    try {
      await ports.discard(entry);
      discarded += 1;
    } catch (error) {
      failed += 1;
      ports.warn(
        `could not expire subagent result ${entry.runId}/${entry.taskId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return { discarded, failed };
}

/** Commit time of a frozen result snapshot; undefined once its objects are gone. */
export async function readSnapshotCommitTimeMs(
  repoPath: string,
  commit: string,
): Promise<number | undefined> {
  const shown = await runGitCommand({
    cwd: repoPath,
    args: ['show', '-s', '--format=%ct', commit],
    allowFailure: true,
  });
  if (shown.exitCode !== 0) return undefined;
  const seconds = Number.parseInt(shown.stdout.trim(), 10);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
