/**
 * CE-SUB-ORCH: workspace service for subagent isolation.
 *
 * Allocates workspace leases (readonly or worktree) for the orchestrator.
 * Readonly tasks use the parent working directory directly. Worktree tasks
 * apply the explicit dirty-base consent policy and run in a checkout.
 *
 * Worktree leases are exclusive per parent project path: a second acquire
 * for the same repo waits until the previous lease is released. Because writes
 * are already single-threaded per project, the checkout itself is shared
 * rather than per task: production deployments supply a writer-slot pool and
 * every task reuses one slot, reset in place. Callers without a storage root
 * (standalone use, tests) keep the one-worktree-per-task behavior.
 */

import { resolve } from 'node:path';
import type {
  SubagentTaskSpec,
  SubagentWorkspaceLease,
  SubagentWorktreeDependencySetup,
} from '@piwin/contracts';
import {
  checkoutWorktreeTree,
  createWorktree,
  isWorktreeBaseClean,
  runGitCommand,
} from '@piwin/git';

import type { WriterSlotPool } from './subagent-writer-slots.js';

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
  /**
   * Shared per-project writer slot. When present (together with a storage
   * root) every worktree task reuses one reset-in-place checkout instead of
   * creating one per task.
   */
  writerSlotPool?: WriterSlotPool;
  /** Install dependencies into a new worktree before the child starts. */
  prepareWorktreeDependencies?: (input: {
    worktreePath: string;
    parentRepoPath: string;
    previousFingerprint?: string | undefined;
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

  /**
   * Slots need both a pool and a storage root; without either there is nothing
   * shared to reuse and the service keeps one checkout per task.
   */
  const slotContext =
    options.writerSlotPool !== undefined && options.worktreeStorageRoot !== undefined
      ? { pool: options.writerSlotPool, storageRoot: options.worktreeStorageRoot }
      : undefined;

  async function prepareDependencies(input: {
    worktreePath: string;
    parentRepoPath: string;
    projectPath: string;
    slotId?: string | undefined;
    baseCommit: string;
    previousFingerprint?: string | undefined;
    signal?: AbortSignal;
  }): Promise<SubagentWorktreeDependencySetup | undefined> {
    const setup = await options.prepareWorktreeDependencies?.({
      worktreePath: input.worktreePath,
      parentRepoPath: input.parentRepoPath,
      ...(input.previousFingerprint !== undefined
        ? { previousFingerprint: input.previousFingerprint }
        : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    // Record the fingerprint even when nothing was installed, so a later task
    // can tell "already correct" from "never attempted".
    if (slotContext && input.slotId !== undefined) {
      await slotContext.pool.recordDependencyFingerprint({
        projectPath: input.projectPath,
        storageRoot: slotContext.storageRoot,
        slotId: input.slotId,
        fingerprint: setup?.fingerprint,
        baseCommit: input.baseCommit,
      });
    }
    return setup;
  }

  /**
   * Acquire the shared slot for a continuation, restoring the child's own last
   * state. The slot may have been reset for another task since, so the frozen
   * tree is checked back out on top of the predecessor's own base commit.
   */
  async function acquireSlotForContinuation(input: {
    slot: { pool: WriterSlotPool; storageRoot: string };
    task: SubagentTaskSpec;
    taskProjectPath: string;
    signal?: AbortSignal;
  }): Promise<SubagentWorkspaceLease> {
    const restore = input.task.continuationRestore;
    if (restore === undefined) {
      // The shared slot has been reset for other tasks since this child ran;
      // without its frozen tree the continuation would resume in a clean (or a
      // stranger's) checkout and silently lose the child's own work.
      throw new Error(
        'subagent result snapshot is unavailable; start a new isolated task to continue',
      );
    }
    // Take the project write lock *before* touching the slot: acquiring resets
    // the checkout, and another writer may be running in it right now.
    const unlock = await acquireProjectWriteLock(resolve(input.taskProjectPath), input.signal);
    try {
      const acquired = await input.slot.pool.acquire({
        projectPath: input.taskProjectPath,
        storageRoot: input.slot.storageRoot,
        baseCommit: restore.baseCommit,
      });
      await checkoutWorktreeTree({ worktreePath: acquired.worktreePath, tree: restore.tree });
      const dependencySetup = await prepareDependencies({
        worktreePath: acquired.worktreePath,
        parentRepoPath: input.taskProjectPath,
        projectPath: input.taskProjectPath,
        slotId: acquired.slotId,
        baseCommit: restore.baseCommit,
        ...(acquired.previousDependencyFingerprint !== undefined
          ? { previousFingerprint: acquired.previousDependencyFingerprint }
          : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const lease: SubagentWorkspaceLease = {
        mode: 'worktree',
        cwd: acquired.worktreePath,
        parentRepoPath: input.taskProjectPath,
        worktreePath: acquired.worktreePath,
        worktreeBranch: acquired.worktreeBranch,
        baseCommit: restore.baseCommit,
        slotId: acquired.slotId,
        ...(dependencySetup ? { dependencySetup } : {}),
      };
      leaseUnlocks.set(lease, unlock);
      return lease;
    } catch (error) {
      unlock();
      throw error;
    }
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
      const continuationProjectPath = existing.parentRepoPath;
      // A continuation that inherits a slot must restore before it runs; the
      // copy it inherits has been reset since the child last wrote to it.
      if (slotContext && existing.slotId !== undefined) {
        return acquireSlotForContinuation({
          slot: slotContext,
          task,
          taskProjectPath: continuationProjectPath,
          ...(acquireOptions.signal ? { signal: acquireOptions.signal } : {}),
        });
      }
      return holdWorktreeLock(continuationProjectPath, existing, acquireOptions.signal);
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
      // Capture the exact parent tip immediately before checkout creation so the
      // lease records the commit that the child was actually based on.
      const headResult = await runGitCommand({
        cwd: taskProjectPath,
        args: ['rev-parse', 'HEAD'],
      });
      const baseCommit = headResult.stdout.trim();
      if (!baseCommit) {
        throw new Error('could not determine the parent repository HEAD commit');
      }

      if (slotContext) {
        const acquired = await slotContext.pool.acquire({
          projectPath: taskProjectPath,
          storageRoot: slotContext.storageRoot,
          baseCommit,
        });
        const dependencySetup = await prepareDependencies({
          worktreePath: acquired.worktreePath,
          parentRepoPath: taskProjectPath,
          projectPath: taskProjectPath,
          slotId: acquired.slotId,
          baseCommit,
          ...(acquired.previousDependencyFingerprint !== undefined
            ? { previousFingerprint: acquired.previousDependencyFingerprint }
            : {}),
          ...(acquireOptions.signal ? { signal: acquireOptions.signal } : {}),
        });
        const lease: SubagentWorkspaceLease = {
          mode: 'worktree',
          cwd: acquired.worktreePath,
          parentRepoPath: taskProjectPath,
          worktreePath: acquired.worktreePath,
          worktreeBranch: acquired.worktreeBranch,
          baseCommit,
          slotId: acquired.slotId,
          ...(dependencySetup ? { dependencySetup } : {}),
        };
        leaseUnlocks.set(lease, unlock);
        return lease;
      }

      const worktree = await createWorktree({
        projectPath: taskProjectPath,
        name: `subagent-${task.id}-${Date.now().toString(36)}`,
        baseRef: baseCommit,
        ...(options.worktreeStorageRoot ? { storageRoot: options.worktreeStorageRoot } : {}),
      });

      const dependencySetup = await prepareDependencies({
        worktreePath: worktree.worktreePath,
        parentRepoPath: taskProjectPath,
        projectPath: taskProjectPath,
        baseCommit,
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
    // A slot lease returns to the pool once the task has frozen its result:
    // the next task resets it in place. Task copies keep the old behavior and
    // leave cleanup to integration, which knows whether the result applied.
    if (lease.slotId !== undefined && slotContext) {
      await slotContext.pool
        .release({
          projectPath: lease.parentRepoPath,
          storageRoot: slotContext.storageRoot,
          slotId: lease.slotId,
        })
        .catch(() => undefined);
    }
  }

  return { acquire, release };
}
