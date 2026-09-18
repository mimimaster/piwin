/**
 * CE-SUB-ORCH: workspace service for subagent isolation.
 *
 * Allocates workspace leases (readonly or worktree) for the orchestrator.
 * Readonly tasks use the parent working directory directly. Worktree tasks
 * apply the explicit dirty-base consent policy, create one worktree per child,
 * install the worktree's dependencies, and retain failed/conflicted worktrees
 * for inspection.
 *
 * Worktree leases are exclusive per parent project path: a second acquire
 * for the same repo waits until the previous lease is released.
 */

import { resolve } from 'node:path';
import type {
  SubagentTaskSpec,
  SubagentWorkspaceLease,
  SubagentWorktreeDependencySetup,
} from '@piwin/contracts';
import { createWorktree, isWorktreeBaseClean, runGitCommand } from '@piwin/git';

export type SubagentWorkspaceServiceOptions = {
  /** Parent project path (used as the worktree base). */
  projectPath: string;
  /** Resolve the parent project for each task's parent session. */
  resolveProjectPath?: (task: SubagentTaskSpec) => string | Promise<string>;
  /** Explicit policy for a dirty git base. */
  dirtyBasePolicy: 'ask' | 'bypass' | (() => Promise<'ask' | 'bypass'>);
  /** One-run permission flow for the `ask` policy. */
  requestDirtyBasePermission?: (
    task: SubagentTaskSpec,
    projectPath: string,
  ) => Promise<'allow' | 'deny'>;
  /** Whether parallel writes are enabled. */
  parallelWritePolicy: 'worktree-only' | 'disabled';
  /** Product-owned root for isolated worktree checkouts. */
  worktreeStorageRoot?: string;
  /** Install dependencies into a new worktree before the child starts. */
  prepareWorktreeDependencies?: (input: {
    worktreePath: string;
    parentRepoPath: string;
    signal?: AbortSignal;
  }) => Promise<SubagentWorktreeDependencySetup>;
};

type ProjectWriteWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  onAbort?: () => void;
  signal?: AbortSignal;
};

type ProjectWriteLock = {
  held: boolean;
  waiters: ProjectWriteWaiter[];
};

export function createSubagentWorkspaceService(options: SubagentWorkspaceServiceOptions): {
  acquire(
    task: SubagentTaskSpec,
    acquireOptions?: { signal?: AbortSignal },
  ): Promise<SubagentWorkspaceLease>;
  release(lease: SubagentWorkspaceLease): Promise<void>;
} {
  const { projectPath, parallelWritePolicy } = options;
  const projectLocks = new Map<string, ProjectWriteLock>();
  const leaseUnlocks = new WeakMap<object, () => void>();

  function acquireProjectWriteLock(key: string, signal?: AbortSignal): Promise<() => void> {
    let lock = projectLocks.get(key);
    if (!lock) {
      lock = { held: false, waiters: [] };
      projectLocks.set(key, lock);
    }

    const grant = (): (() => void) => {
      lock.held = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        lock.held = false;
        const next = lock.waiters.shift();
        if (next) {
          if (next.signal && next.onAbort) {
            next.signal.removeEventListener('abort', next.onAbort);
          }
          next.resolve();
          return;
        }
        if (!lock.held && lock.waiters.length === 0) {
          projectLocks.delete(key);
        }
      };
    };

    if (!lock.held && lock.waiters.length === 0) {
      return Promise.resolve(grant());
    }
    if (signal?.aborted) {
      return Promise.reject(new Error('aborted'));
    }
    return new Promise<() => void>((resolveLock, rejectLock) => {
      const waiter: ProjectWriteWaiter = {
        resolve: () => resolveLock(grant()),
        reject: rejectLock,
      };
      const onAbort = (): void => {
        const index = lock.waiters.indexOf(waiter);
        if (index >= 0) {
          lock.waiters.splice(index, 1);
        }
        rejectLock(new Error('aborted'));
      };
      waiter.onAbort = onAbort;
      if (signal) waiter.signal = signal;
      lock.waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function holdWorktreeLock(
    taskProjectPath: string,
    lease: SubagentWorkspaceLease,
    signal?: AbortSignal,
  ): Promise<SubagentWorkspaceLease> {
    const unlock = await acquireProjectWriteLock(resolve(taskProjectPath), signal);
    leaseUnlocks.set(lease, unlock);
    return lease;
  }

  async function acquire(
    task: SubagentTaskSpec,
    acquireOptions: { signal?: AbortSignal } = {},
  ): Promise<SubagentWorkspaceLease> {
    if (task.continuationWorkspaceLease) {
      const existing = task.continuationWorkspaceLease;
      if (existing.mode !== 'worktree') {
        return existing;
      }
      return holdWorktreeLock(existing.parentRepoPath, existing, acquireOptions.signal);
    }

    const taskProjectPath = (await options.resolveProjectPath?.(task)) ?? projectPath;
    const mode = task.isolationOverride ?? 'readonly';

    if (mode === 'readonly') {
      return {
        mode: 'readonly',
        cwd: taskProjectPath,
        parentRepoPath: taskProjectPath,
      };
    }

    // Worktree mode.
    if (parallelWritePolicy === 'disabled') {
      throw new Error('parallel writes are disabled in Settings');
    }

    const unlock = await acquireProjectWriteLock(resolve(taskProjectPath), acquireOptions.signal);
    try {
      const baseIsClean = await isWorktreeBaseClean(taskProjectPath);
      const dirtyBasePolicy =
        typeof options.dirtyBasePolicy === 'function'
          ? await options.dirtyBasePolicy()
          : options.dirtyBasePolicy;
      if (!baseIsClean && dirtyBasePolicy === 'ask') {
        const decision = await options.requestDirtyBasePermission?.(task, taskProjectPath);
        if (decision !== 'allow') {
          throw new Error('dirty-base-denied: prepare or stash the repository before continuing');
        }
      }
      if (!baseIsClean && dirtyBasePolicy !== 'bypass' && !options.requestDirtyBasePermission) {
        throw new Error('dirty-base-denied: no permission flow is available');
      }
      // Capture the exact parent tip immediately before worktree creation so the
      // lease records the commit that the child was actually based on.
      const headResult = await runGitCommand({
        cwd: taskProjectPath,
        args: ['rev-parse', 'HEAD'],
      });
      const baseCommit = headResult.stdout.trim();
      if (!baseCommit) {
        throw new Error('could not determine the parent repository HEAD commit');
      }

      const worktree = await createWorktree({
        projectPath: taskProjectPath,
        name: `subagent-${task.id}-${Date.now().toString(36)}`,
        baseRef: baseCommit,
        ...(options.worktreeStorageRoot ? { storageRoot: options.worktreeStorageRoot } : {}),
      });

      const dependencySetup = await options.prepareWorktreeDependencies?.({
        worktreePath: worktree.worktreePath,
        parentRepoPath: taskProjectPath,
        ...(acquireOptions.signal ? { signal: acquireOptions.signal } : {}),
      });

      const lease: SubagentWorkspaceLease = {
        mode: 'worktree',
        cwd: worktree.worktreePath,
        parentRepoPath: taskProjectPath,
        worktreePath: worktree.worktreePath,
        worktreeBranch: worktree.branch,
        baseCommit,
        ...(dependencySetup ? { dependencySetup } : {}),
      };
      leaseUnlocks.set(lease, unlock);
      return lease;
    } catch (error) {
      unlock();
      throw error;
    }
  }

  async function release(lease: SubagentWorkspaceLease): Promise<void> {
    const unlock = leaseUnlocks.get(lease);
    if (unlock) {
      leaseUnlocks.delete(lease);
      unlock();
    }
    // Readonly leases have nothing else to release.
    if (lease.mode === 'readonly') return;
    // Integration owns worktree cleanup because it knows whether the result
    // was applied successfully or must be retained for inspection.
  }

  return { acquire, release };
}
