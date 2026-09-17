/**
 * Inventory leftover subagent worktrees and reclaim the ones policy allows.
 * Delete only through `git worktree remove` + generated `piwin/subagent/*`
 * branch cleanup — never `rm -rf`.
 */
import { execFile } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type {
  SubagentWorktreeGcEntry,
  SubagentWorktreeGcMode,
  SubagentWorktreeGcPreview,
  SubagentWorktreeGcResult,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { SubagentRunManifest } from '@piwin/session';
import { listGitWorktrees } from '@piwin/git';
import {
  decideWorktreeGc,
  isSubagentWorktreeBranch,
  isUnfrozenWorktreeSnapshot,
} from './subagent-worktree-gc-policy.js';

const MAX_PREVIEW_ENTRIES = 200;

export type WorktreeGitInfo = {
  isPrimary: boolean;
  locked: boolean;
  branch: string | null;
  parentRepoPath?: string;
};

export type SubagentWorktreeGcController = {
  preview(): Promise<SubagentWorktreeGcPreview>;
  reclaim(input: { mode: SubagentWorktreeGcMode }): Promise<SubagentWorktreeGcResult>;
};

export type SubagentWorktreeGcControllerOptions = {
  storageRoot: string;
  listManifests: () => Promise<readonly SubagentRunManifest[]>;
  isRunActive: (runId: string) => boolean;
  listPausedBatchRunIds: () => Promise<ReadonlySet<string>>;
  whenReady?: () => Promise<void>;
  removeWorktree: (input: {
    parentRepoPath: string;
    worktreePath: string;
    worktreeBranch?: string;
  }) => Promise<void>;
  now?: () => number;
  measureBytes?: (worktreePath: string) => Promise<number>;
  lookupGit?: (input: {
    worktreePath: string;
    parentRepoPath?: string;
  }) => Promise<WorktreeGitInfo>;
};

type LeaseRecord = {
  worktreePath: string;
  parentRepoPath: string;
  worktreeBranch?: string;
  runId: string;
  taskId: string;
  parentSessionId: string;
  running: boolean;
  pendingIntegration: boolean;
  conflict: boolean;
  userRetained: boolean;
  unfrozenSnapshot: boolean;
  updatedAtMs: number;
};

export function createSubagentWorktreeGcController(
  options: SubagentWorktreeGcControllerOptions,
): SubagentWorktreeGcController {
  const now = options.now ?? (() => Date.now());
  const measureBytes = options.measureBytes ?? measureDirectoryBytes;
  const lookupGit = options.lookupGit ?? lookupGitWorktree;
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = tail.then(operation, operation);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function collect(mode: SubagentWorktreeGcMode): Promise<SubagentWorktreeGcEntry[]> {
    await options.whenReady?.();
    const storageRoot = resolve(options.storageRoot);
    const manifests = await options.listManifests();
    const paused = await options.listPausedBatchRunIds();
    const leases = collectLeaseRecords(manifests, options.isRunActive);
    const diskPaths = await listStorageWorktreePaths(storageRoot);
    const byPath = new Map<string, LeaseRecord>();
    for (const lease of leases) {
      byPath.set(resolve(lease.worktreePath), lease);
    }

    const seen = new Set<string>();
    const entries: SubagentWorktreeGcEntry[] = [];
    for (const diskPath of diskPaths) {
      const resolved = resolve(diskPath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      entries.push(
        await buildEntry({
          worktreePath: resolved,
          lease: byPath.get(resolved),
          storageRoot,
          mode,
          paused,
          nowMs: now(),
          measureBytes,
          lookupGit,
        }),
      );
    }
    for (const lease of leases) {
      const resolved = resolve(lease.worktreePath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      try {
        if (!(await isDirectory(resolved))) continue;
      } catch {
        continue;
      }
      entries.push(
        await buildEntry({
          worktreePath: resolved,
          lease,
          storageRoot,
          mode,
          paused,
          nowMs: now(),
          measureBytes,
          lookupGit,
        }),
      );
    }
    entries.sort((left, right) => right.bytes - left.bytes || left.worktreePath.localeCompare(right.worktreePath));
    return entries.slice(0, MAX_PREVIEW_ENTRIES);
  }

  return {
    preview() {
      return enqueue(async () => summarize(await collect('manual')));
    },
    reclaim(input) {
      return enqueue(async () => {
        const entries = await collect(input.mode);
        const result: SubagentWorktreeGcResult = {
          removedCount: 0,
          removedBytes: 0,
          failed: [],
        };
        for (const entry of entries) {
          if (!entry.reclaimable) continue;
          const parentRepoPath = entry.parentRepoPath;
          if (!parentRepoPath) {
            result.failed.push({
              worktreePath: entry.worktreePath,
              error: 'missing parent repository path',
            });
            continue;
          }
          try {
            await options.removeWorktree({
              parentRepoPath,
              worktreePath: entry.worktreePath,
              ...(entry.worktreeBranch ? { worktreeBranch: entry.worktreeBranch } : {}),
            });
            result.removedCount += 1;
            result.removedBytes += entry.bytes;
          } catch (error) {
            result.failed.push({
              worktreePath: entry.worktreePath,
              error: formatError(error),
            });
          }
        }
        return result;
      });
    },
  };
}

function summarize(entries: SubagentWorktreeGcEntry[]): SubagentWorktreeGcPreview {
  let totalBytes = 0;
  let reclaimableBytes = 0;
  let reclaimableCount = 0;
  for (const entry of entries) {
    totalBytes += entry.bytes;
    if (entry.reclaimable) {
      reclaimableBytes += entry.bytes;
      reclaimableCount += 1;
    }
  }
  return { entries, totalBytes, reclaimableBytes, reclaimableCount };
}

function collectLeaseRecords(
  manifests: readonly SubagentRunManifest[],
  isRunActive: (runId: string) => boolean,
): LeaseRecord[] {
  const records: LeaseRecord[] = [];
  for (const manifest of manifests) {
    const updatedAtMs = Date.parse(manifest.updatedAt) || 0;
    for (const [taskId, lease] of Object.entries(manifest.leases)) {
      if (lease.mode !== 'worktree') continue;
      const task = manifest.tasks.find((candidate) => candidate.id === taskId);
      const result = manifest.results[taskId];
      const executionStatus = result?.executionStatus ?? 'queued';
      const integrationStatus = result?.integrationStatus ?? 'not-requested';
      records.push({
        worktreePath: lease.worktreePath,
        parentRepoPath: lease.parentRepoPath,
        ...(lease.worktreeBranch ? { worktreeBranch: lease.worktreeBranch } : {}),
        runId: manifest.runId,
        taskId,
        parentSessionId: manifest.parentSessionId,
        running:
          manifest.status === 'running' ||
          executionStatus === 'queued' ||
          executionStatus === 'running' ||
          isRunActive(manifest.runId),
        pendingIntegration: integrationStatus === 'pending',
        conflict: integrationStatus === 'conflict',
        userRetained: task?.retainWorktree === true || integrationStatus === 'retained',
        unfrozenSnapshot: isUnfrozenWorktreeSnapshot({
          executionStatus,
          integrationStatus,
          ...(result?.deliveryIntent
            ? { deliveryIntent: result.deliveryIntent }
            : task?.deliveryIntent
              ? { deliveryIntent: task.deliveryIntent }
              : {}),
          hasResultRef: Boolean(result?.resultRef ?? task?.resultRef),
        }),
        updatedAtMs,
      });
    }
  }
  return records;
}

async function buildEntry(input: {
  worktreePath: string;
  lease: LeaseRecord | undefined;
  storageRoot: string;
  mode: SubagentWorktreeGcMode;
  paused: ReadonlySet<string>;
  nowMs: number;
  measureBytes: (worktreePath: string) => Promise<number>;
  lookupGit: (input: {
    worktreePath: string;
    parentRepoPath?: string;
  }) => Promise<WorktreeGitInfo>;
}): Promise<SubagentWorktreeGcEntry> {
  const inside = await isInsideStorageRoot(input.storageRoot, input.worktreePath);
  let git: WorktreeGitInfo = {
    isPrimary: false,
    locked: false,
    branch: input.lease?.worktreeBranch ?? null,
    ...(input.lease ? { parentRepoPath: input.lease.parentRepoPath } : {}),
  };
  try {
    git = {
      ...git,
      ...(await input.lookupGit({
        worktreePath: input.worktreePath,
        ...(input.lease ? { parentRepoPath: input.lease.parentRepoPath } : {}),
      })),
    };
  } catch {
    git = { ...git, isPrimary: true };
  }

  const mtimeMs = Math.max(await readMtimeMs(input.worktreePath), input.lease?.updatedAtMs ?? 0);
  const branch = git.branch ?? input.lease?.worktreeBranch ?? null;
  const branchAllowed = branch === null || isSubagentWorktreeBranch(branch);
  const decision = decideWorktreeGc(
    {
      orphan: input.lease === undefined,
      unsafePath: !inside,
      isPrimary: git.isPrimary,
      locked: git.locked,
      branchAllowed,
      running: input.lease?.running === true,
      pendingIntegration: input.lease?.pendingIntegration === true,
      conflict: input.lease?.conflict === true,
      userRetained: input.lease?.userRetained === true,
      unfrozenSnapshot: input.lease?.unfrozenSnapshot === true,
      pauseCheckpoint: input.lease !== undefined && input.paused.has(input.lease.runId),
      ageMs: Math.max(0, input.nowMs - mtimeMs),
    },
    { mode: input.mode },
  );
  const parentRepoPath = git.parentRepoPath ?? input.lease?.parentRepoPath;
  const worktreeBranch = branch && isSubagentWorktreeBranch(branch) ? branch : input.lease?.worktreeBranch;
  const bytes = await input.measureBytes(input.worktreePath);
  return {
    worktreePath: input.worktreePath,
    ...(parentRepoPath ? { parentRepoPath } : {}),
    ...(worktreeBranch ? { worktreeBranch } : {}),
    ...(input.lease
      ? {
          runId: input.lease.runId,
          taskId: input.lease.taskId,
          parentSessionId: input.lease.parentSessionId,
        }
      : {}),
    bytes,
    mtimeMs,
    orphan: input.lease === undefined,
    reclaimable: decision.reclaimable,
    keepReasons: decision.keepReasons,
  };
}

async function sameFilesystemPath(left: string, right: string): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return resolve(left) === resolve(right);
  }
}

export async function lookupGitWorktree(input: {
  worktreePath: string;
  parentRepoPath?: string;
}): Promise<WorktreeGitInfo> {
  const cwd = input.parentRepoPath ?? input.worktreePath;
  const listed = await listGitWorktrees({ rootPath: cwd, isRepository: true });
  let match;
  for (const entry of listed.worktrees) {
    if (await sameFilesystemPath(entry.worktreePath, input.worktreePath)) {
      match = entry;
      break;
    }
  }
  const primary = listed.worktrees.find((entry) => entry.isPrimary);
  if (!match) {
    return {
      isPrimary: false,
      locked: false,
      branch: null,
      ...(primary ? { parentRepoPath: primary.worktreePath } : {}),
    };
  }
  return {
    isPrimary: match.isPrimary,
    locked: match.locked,
    branch: match.branch,
    ...(primary && !match.isPrimary ? { parentRepoPath: primary.worktreePath } : {}),
  };
}

export async function listStorageWorktreePaths(storageRoot: string): Promise<string[]> {
  const paths: string[] = [];
  let repoDirs;
  try {
    repoDirs = await readdir(storageRoot, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  for (const repo of repoDirs) {
    if (!repo.isDirectory()) continue;
    const repoPath = join(storageRoot, repo.name);
    let children;
    try {
      children = await readdir(repoPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const worktreePath = join(repoPath, child.name);
      if (await hasGitMetadata(worktreePath)) {
        paths.push(worktreePath);
      }
    }
  }
  return paths;
}

export async function isInsideStorageRoot(
  storageRoot: string,
  candidate: string,
): Promise<boolean> {
  let root: string;
  try {
    root = await realpath(storageRoot);
  } catch {
    return false;
  }
  let path: string;
  try {
    path = await realpath(candidate);
  } catch {
    path = resolve(candidate);
  }
  return path === root || path.startsWith(root + sep);
}

async function hasGitMetadata(worktreePath: string): Promise<boolean> {
  try {
    await stat(join(worktreePath, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readMtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

export function measureDirectoryBytes(directoryPath: string): Promise<number> {
  return new Promise((resolveBytes) => {
    execFile('du', ['-sk', directoryPath], { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        resolveBytes(0);
        return;
      }
      const kilobytes = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? '', 10);
      resolveBytes(Number.isFinite(kilobytes) ? kilobytes * 1024 : 0);
    });
  });
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}
