/**
 * CE-SUB-ORCH: serialized three-way code integration coordinator.
 *
 * Implements the worktree and integration rules from runtime-refactor §3.9
 * and ADR 0030 conflict retention rules.
 *
 * SC-10: Parallel writes use one worktree per child and serialized integration.
 * SC-11: Execution, summary merge, and code integration remain separate axes.
 * SC-12: Integration conflict makes the Run failed with `integration-required`.
 *
 * Integration is serialized by normalized repository identity (rule 4), not
 * session ID. Each repo path gets a promise chain so integrations for the
 * same repo never overlap. Conflicted or failed worktrees are retained
 * (rule 6) and never cleaned up by `dispose` (rule 7).
 */

import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';

import type { SubagentTaskResult, SubagentWorkspaceLease } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type {
  WorktreeIntegrationInput as GitWorktreeIntegrationInput,
  WorktreeIntegrationResult as GitWorktreeIntegrationResult,
} from '@piwin/git';
import { settleAppliedWorktreeCopy } from './subagent-copy-cleanup.js';
import type {
  WorkspaceWriteGate,
  WorkspaceWriteLease,
} from './turn-changes/workspace-write-gate.js';

export type WorktreeIntegrationInput = {
  readonly worktreePath: string;
  readonly worktreeBranch: string;
  readonly baseCommit: string;
  readonly parentRepoPath: string;
  /**
   * Relative paths the integration may apply. `undefined` means unrestricted;
   * an explicit empty list denies every changed file.
   */
  readonly allowedOutputPaths?: readonly string[];
};

export type WorktreeIntegrationResult =
  | { success: true; changedFiles: string[]; allowedOutputPaths: string[] }
  | {
      success: false;
      conflict: true;
      conflictFiles: string[];
      error?: string;
      allowedOutputPaths: string[];
    }
  | {
      success: false;
      conflict: false;
      error: string;
      allowedOutputPaths: string[];
    };

/** Function shape used by the coordinator after adapting a Git service. */
export type WorktreeIntegrationFunction = (
  input: WorktreeIntegrationInput,
) => Promise<WorktreeIntegrationResult>;

/**
 * Adapt the application Git integration result to the coordinator result.
 *
 * The Git package uses `projectPath` and a status-based result, while the
 * coordinator uses `parentRepoPath` and explicit success/conflict axes. This
 * adapter preserves the allowed path list while translating between them.
 */
export function createGitWorktreeIntegrationAdapter(
  integrateWorktreeChanges: (
    input: GitWorktreeIntegrationInput,
  ) => Promise<GitWorktreeIntegrationResult>,
): WorktreeIntegrationFunction {
  return async (input) => {
    const gitResult = await integrateWorktreeChanges({
      projectPath: input.parentRepoPath,
      worktreePath: input.worktreePath,
      worktreeBranch: input.worktreeBranch,
      baseCommit: input.baseCommit,
      ...(input.allowedOutputPaths
        ? { allowedOutputPaths: [...input.allowedOutputPaths] }
        : {}),
    });

    if (gitResult.status === 'applied') {
      return {
        success: true,
        changedFiles: [...gitResult.integratedFiles],
        allowedOutputPaths: input.allowedOutputPaths ? [...input.allowedOutputPaths] : [],
      };
    }

    if (gitResult.status === 'conflict') {
      return {
        success: false,
        conflict: true,
        conflictFiles: gitResult.conflictedFiles,
        ...(gitResult.error ? { error: gitResult.error } : {}),
        allowedOutputPaths: input.allowedOutputPaths ? [...input.allowedOutputPaths] : [],
      };
    }

    return {
      success: false,
      conflict: false,
      error: gitResult.error ?? `integration rejected files: ${gitResult.rejectedFiles.join(', ')}`,
      allowedOutputPaths: input.allowedOutputPaths ? [...input.allowedOutputPaths] : [],
    };
  };
}

export type SubagentIntegrationCoordinatorOptions = {
  /** Function to integrate worktree changes (from @piwin/git). */
  integrateWorktree: WorktreeIntegrationFunction;
  /** Function to check if worktree base is clean. */
  isBaseClean: (repoPath: string) => Promise<boolean>;
  /** Function to remove a worktree. */
  removeWorktree: (
    worktreePath: string,
    parentRepoPath: string,
    worktreeBranch?: string,
  ) => Promise<void>;
  /** Exclusive parent-workspace lock; acquired after the repo serial queue. */
  workspaceWriteGate?: WorkspaceWriteGate;
};

export type SubagentIntegrationControl = {
  /** Cancellation is actionable only before the integration commit point. */
  readonly signal?: AbortSignal;
  /** Called immediately before the parent-mutating integration function starts. */
  readonly onCommitPoint?: () => void;
  /** Keep the child copy after a successful apply. Does not skip integrate. */
  readonly retainWorktree?: boolean;
};

export class IntegrationQueueCancelledError extends Error {
  readonly name = 'IntegrationQueueCancelledError';

  constructor(message = 'integration cancelled before parent mutation') {
    super(message);
  }
}

export type SubagentIntegrationCoordinator = {
  /**
   * Serialize and integrate a completed task's worktree changes.
   * Integration is serialized by normalized repository identity.
   * Returns the updated task result with integration status.
   */
  integrate(
    result: SubagentTaskResult,
    lease: SubagentWorkspaceLease,
    control?: SubagentIntegrationControl,
  ): Promise<SubagentTaskResult>;

  /** Retain a failed/conflicted worktree for inspection. */
  retain(worktreePath: string, reason: string): Promise<void>;

  /** Check if a base is clean for parallel writes. */
  isBaseClean(repoPath: string): Promise<boolean>;

  /** Dispose: clean up any non-retained worktrees. */
  dispose(): Promise<void>;
};

/**
 * Normalize a repository path for use as a serialization key.
 * Resolves relative paths to absolute and resolves symlinks to their real
 * paths so that different string representations of the same repo (e.g.
 * `/foo/bar` and `/foo/../foo/bar`, or a symlinked directory) always map
 * to the same lock key.
 */
function normalizeRepoPath(repoPath: string): string {
  const resolved = resolve(repoPath);
  try {
    return realpathSync(resolved);
  } catch {
    // If realpath fails (path doesn't exist yet), use the resolved path.
    return resolved;
  }
}

function normalizeOutputPath(outputPath: string): string {
  return outputPath.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function findDisallowedOutputPaths(
  changedFiles: string[],
  allowedOutputPaths: readonly string[] | undefined,
): string[] {
  // `undefined` means unrestricted; an explicit empty list denies everything.
  if (allowedOutputPaths === undefined) return [];
  if (allowedOutputPaths.length === 0) return [...changedFiles];

  const allowedPathSet = new Set(allowedOutputPaths.map(normalizeOutputPath));
  return changedFiles.filter(
    (changedFile) => !allowedPathSet.has(normalizeOutputPath(changedFile)),
  );
}

type IntegrationQueueEntry = {
  state: 'queued' | 'acquired' | 'cancelled' | 'released';
  resolve: (lease: IntegrationQueueLease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortListener: (() => void) | undefined;
};

type IntegrationQueueState = {
  active: boolean;
  entries: IntegrationQueueEntry[];
};

type IntegrationQueueLease = {
  release(): void;
};

/** Internal record tracking a retained worktree. */
type RetainedWorktree = {
  worktreePath: string;
  reason: string;
  retainedAt: string;
};

/**
 * Create a `SubagentIntegrationCoordinator` that serializes three-way
 * worktree integration by repository identity.
 *
 * The coordinator does not perform git operations directly — it delegates
 * to injected functions (`integrateWorktree`, `removeWorktree`) typically
 * backed by `@piwin/git`. Its sole responsibility is serialization,
 * status mapping, and retention tracking.
 */
export function createSubagentIntegrationCoordinator(
  options: SubagentIntegrationCoordinatorOptions,
): SubagentIntegrationCoordinator {
  const { integrateWorktree, isBaseClean, removeWorktree, workspaceWriteGate } = options;

  /** Explicit FIFO queues allow a cancelled waiter to be removed safely. */
  const integrationQueues = new Map<string, IntegrationQueueState>();

  /** Worktrees retained for inspection, missing freeze, or retainWorktree. */
  const retainedWorktrees = new Map<string, RetainedWorktree>();

  /** Worktrees created during this coordinator's lifetime (for dispose). */
  const managedWorktrees = new Map<string, string>();

  /**
   * Acquire the serialized integration slot for a repo path.
   * Returns a release function that must be called after the integration
   * attempt completes (success or failure).
   */
  function acquireIntegrationSlot(
    repoPath: string,
    worktreePath: string,
    signal?: AbortSignal,
  ): Promise<IntegrationQueueLease> {
    const key = normalizeRepoPath(repoPath);
    managedWorktrees.set(worktreePath, repoPath);

    if (signal?.aborted) {
      return Promise.reject(new IntegrationQueueCancelledError());
    }

    const queue = integrationQueues.get(key) ?? { active: false, entries: [] };
    integrationQueues.set(key, queue);

    return new Promise<IntegrationQueueLease>((resolveLease, rejectLease) => {
      const entry: IntegrationQueueEntry = {
        state: 'queued',
        resolve: resolveLease,
        reject: rejectLease,
        abortListener: undefined,
        ...(signal ? { signal } : {}),
      };

      const removeAbortListener = (): void => {
        if (entry.signal && entry.abortListener) {
          entry.signal.removeEventListener('abort', entry.abortListener);
        }
        entry.abortListener = undefined;
      };

      const grantNextEntry = (): void => {
        if (queue.active) return;

        while (queue.entries.length > 0) {
          const nextEntry = queue.entries.shift();
          if (!nextEntry || nextEntry.state !== 'queued') continue;

          queue.active = true;
          nextEntry.state = 'acquired';
          if (nextEntry.signal && nextEntry.abortListener) {
            nextEntry.signal.removeEventListener('abort', nextEntry.abortListener);
          }
          nextEntry.abortListener = undefined;

          let released = false;
          nextEntry.resolve({
            release: () => {
              if (released) return;
              released = true;
              nextEntry.state = 'released';
              queue.active = false;
              grantNextEntry();
            },
          });
          return;
        }

        integrationQueues.delete(key);
      };

      entry.abortListener = () => {
        if (entry.state !== 'queued') return;
        entry.state = 'cancelled';
        const entryIndex = queue.entries.indexOf(entry);
        if (entryIndex >= 0) queue.entries.splice(entryIndex, 1);
        removeAbortListener();
        entry.reject(new IntegrationQueueCancelledError());
        grantNextEntry();
      };

      signal?.addEventListener('abort', entry.abortListener, { once: true });
      queue.entries.push(entry);
      grantNextEntry();
    });
  }

  async function integrate(
    result: SubagentTaskResult,
    lease: SubagentWorkspaceLease,
    control: SubagentIntegrationControl = {},
  ): Promise<SubagentTaskResult> {
    // Readonly leases have no worktree to integrate.
    if (lease.mode === 'readonly') {
      return {
        ...result,
        integrationStatus: 'not-requested',
      };
    }

    const worktreePath = lease.worktreePath;
    const worktreeBranch = lease.worktreeBranch;
    const baseCommit = lease.baseCommit;
    const parentRepoPath = lease.parentRepoPath;
    // `undefined` stays unrestricted; an explicit empty list is deny-all.
    const allowedOutputPaths = result.allowedOutputPaths
      ? [...result.allowedOutputPaths]
      : undefined;

    let slot: IntegrationQueueLease | undefined;
    let writeLease: WorkspaceWriteLease | undefined;

    try {
      slot = await acquireIntegrationSlot(parentRepoPath, worktreePath, control.signal);
      if (control.signal?.aborted) {
        throw new IntegrationQueueCancelledError();
      }

      if (workspaceWriteGate) {
        const acquired = await workspaceWriteGate.tryAcquire({
          workspaceId: parentRepoPath,
          rootPath: parentRepoPath,
          kind: 'integration',
        });
        if (!acquired.ok) {
          await retain(worktreePath, acquired.reason);
          return {
            ...result,
            integrationStatus: 'failed',
            error: acquired.reason,
            worktreePath,
          };
        }
        writeLease = acquired.lease;
      }

      // The current Git adapter is a one-shot operation. Until the durable
      // prepare/apply journal is introduced, this is the conservative commit
      // point: cancellation can remove queued work before this callback, but
      // cannot interrupt or relabel a Git operation after it starts.
      control.onCommitPoint?.();
      const integrationResult = await integrateWorktree({
        worktreePath,
        worktreeBranch,
        baseCommit,
        parentRepoPath,
        ...(allowedOutputPaths !== undefined ? { allowedOutputPaths } : {}),
      });

      if (integrationResult.success) {
        const disallowedOutputPaths = findDisallowedOutputPaths(
          integrationResult.changedFiles,
          allowedOutputPaths,
        );
        if (disallowedOutputPaths.length > 0) {
          await retain(
            worktreePath,
            `integration rejected files outside allowedOutputPaths: ${disallowedOutputPaths.join(', ')}`,
          );
          return {
            ...result,
            integrationStatus: 'failed',
            error: `files outside allowedOutputPaths: ${disallowedOutputPaths.join(', ')}`,
            worktreePath,
          };
        }

        return settleAppliedWorktreeCopy({
          result,
          changedFiles: integrationResult.changedFiles,
          worktreePath,
          ...(control.retainWorktree === true ? { retainWorktree: true } : {}),
          removeWorktree: () => removeWorktree(worktreePath, parentRepoPath, worktreeBranch),
          keepWorktree: (reason) => retain(worktreePath, reason),
          onRemoved: () => {
            managedWorktrees.delete(worktreePath);
          },
        });
      }

      if (integrationResult.conflict) {
        // SC-12 / rule 6: retain conflicted worktrees.
        const conflictDetail = integrationResult.error
          ? `${integrationResult.conflictFiles.join(', ')} (${integrationResult.error})`
          : integrationResult.conflictFiles.join(', ');
        await retain(worktreePath, `conflict: ${conflictDetail}`);
        return {
          ...result,
          integrationStatus: 'conflict',
          error: `integration conflict in: ${conflictDetail}`,
          worktreePath,
        };
      }

      // Non-conflict failure: retain and mark as failed.
      await retain(worktreePath, `integration error: ${integrationResult.error}`);
      return {
        ...result,
        integrationStatus: 'failed',
        error: integrationResult.error,
        worktreePath,
      };
    } catch (error) {
      if (error instanceof IntegrationQueueCancelledError) {
        await retain(worktreePath, error.message);
        return {
          ...result,
          integrationStatus: 'retained',
          error: error.message,
          worktreePath,
        };
      }
      const message = formatError(error);
      // Unexpected error during integration: retain and mark as failed.
      await retain(worktreePath, `integration exception: ${message}`);
      return {
        ...result,
        integrationStatus: 'failed',
        error: message,
        worktreePath,
      };
    } finally {
      writeLease?.release();
      slot?.release();
    }
  }

  async function retain(worktreePath: string, reason: string): Promise<void> {
    retainedWorktrees.set(worktreePath, {
      worktreePath,
      reason,
      retainedAt: new Date().toISOString(),
    });
    // A retained worktree is removed from the managed set so dispose
    // will not clean it up (rule 7).
    managedWorktrees.delete(worktreePath);
  }

  async function checkBaseClean(repoPath: string): Promise<boolean> {
    return isBaseClean(repoPath);
  }

  async function dispose(): Promise<void> {
    // Only clean up non-retained worktrees (rule 7).
    const toRemove = Array.from(managedWorktrees.entries());
    managedWorktrees.clear();

    const removals = toRemove.map(async ([worktreePath, parentRepoPath]) => {
      try {
        await removeWorktree(worktreePath, parentRepoPath);
      } catch {
        // Best-effort cleanup; do not throw from dispose.
      }
    });

    await Promise.all(removals);
  }

  return {
    integrate,
    retain,
    isBaseClean: checkBaseClean,
    dispose,
  };
}
