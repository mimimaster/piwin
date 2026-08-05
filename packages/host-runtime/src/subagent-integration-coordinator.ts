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
import type {
  WorktreeIntegrationInput as GitWorktreeIntegrationInput,
  WorktreeIntegrationResult as GitWorktreeIntegrationResult,
} from '@piwin/git';

export type WorktreeIntegrationInput = {
  readonly worktreePath: string;
  readonly worktreeBranch: string;
  readonly baseCommit: string;
  readonly parentRepoPath: string;
  /** Relative paths that the integration operation may apply. */
  readonly allowedOutputPaths: string[];
};

export type WorktreeIntegrationResult =
  | { success: true; changedFiles: string[]; allowedOutputPaths: string[] }
  | {
      success: false;
      conflict: true;
      conflictFiles: string[];
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
      allowedOutputPaths: input.allowedOutputPaths,
    });

    if (gitResult.status === 'applied') {
      return {
        success: true,
        changedFiles: gitResult.integratedFiles,
        allowedOutputPaths: input.allowedOutputPaths,
      };
    }

    if (gitResult.status === 'conflict') {
      return {
        success: false,
        conflict: true,
        conflictFiles: gitResult.conflictedFiles,
        allowedOutputPaths: input.allowedOutputPaths,
      };
    }

    return {
      success: false,
      conflict: false,
      error:
        gitResult.error ??
        `integration rejected files: ${gitResult.rejectedFiles.join(', ')}`,
      allowedOutputPaths: input.allowedOutputPaths,
    };
  };
}

export type SubagentIntegrationCoordinatorOptions = {
  /** Function to integrate worktree changes (from @piwin/git). */
  integrateWorktree: WorktreeIntegrationFunction;
  /** Function to check if worktree base is clean. */
  isBaseClean: (repoPath: string) => Promise<boolean>;
  /** Function to remove a worktree. */
  removeWorktree: (worktreePath: string, parentRepoPath: string) => Promise<void>;
};

export type SubagentIntegrationCoordinator = {
  /**
   * Serialize and integrate a completed task's worktree changes.
   * Integration is serialized by normalized repository identity.
   * Returns the updated task result with integration status.
   */
  integrate(
    result: SubagentTaskResult,
    lease: SubagentWorkspaceLease,
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
  allowedOutputPaths: string[],
): string[] {
  if (allowedOutputPaths.length === 0) return [];

  const allowedPathSet = new Set(allowedOutputPaths.map(normalizeOutputPath));
  return changedFiles.filter((changedFile) => !allowedPathSet.has(normalizeOutputPath(changedFile)));
}

type CompletionLatch = {
  promise: Promise<void>;
  resolve(): void;
};

function createCompletionLatch(): CompletionLatch {
  let resolveCompletion: (() => void) | undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolveCompletion = resolvePromise;
  });
  let isResolved = false;

  return {
    promise,
    resolve: () => {
      if (isResolved) return;
      if (!resolveCompletion) {
        throw new Error('integration completion latch was not initialized');
      }
      isResolved = true;
      resolveCompletion();
    },
  };
}

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
  const { integrateWorktree, isBaseClean, removeWorktree } = options;

  /** Promise chain per normalized repo path for serialized integration. */
  const integrationLocks = new Map<string, Promise<void>>();

  /** Worktrees retained due to conflict or failure; never cleaned up. */
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
  ): { whenReady: () => Promise<void>; release: () => void } {
    const key = normalizeRepoPath(repoPath);
    const previous = integrationLocks.get(key) ?? Promise.resolve();

    const completionLatch = createCompletionLatch();
    // The current queue entry remains pending until this operation releases
    // it. A later operation therefore waits for completion, not start.
    const queued = previous.then(() => completionLatch.promise);
    integrationLocks.set(key, queued);

    managedWorktrees.set(worktreePath, repoPath);

    return {
      whenReady: () => previous,
      release: () => {
        completionLatch.resolve();
        // Clear the lock only if our chained promise is still the current one.
        const current = integrationLocks.get(key);
        if (current === queued) {
          integrationLocks.delete(key);
        }
      },
    };
  }

  async function integrate(
    result: SubagentTaskResult,
    lease: SubagentWorkspaceLease,
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
    const allowedOutputPaths = result.allowedOutputPaths
      ? [...result.allowedOutputPaths]
      : [];

    const slot = acquireIntegrationSlot(parentRepoPath, worktreePath);

    try {
      await slot.whenReady();

      const integrationResult = await integrateWorktree({
        worktreePath,
        worktreeBranch,
        baseCommit,
        parentRepoPath,
        allowedOutputPaths,
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

        try {
          await removeWorktree(worktreePath, parentRepoPath);
          managedWorktrees.delete(worktreePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await retain(worktreePath, `integration applied but worktree cleanup failed: ${message}`);
          return {
            ...result,
            integrationStatus: 'failed',
            error: `integration applied but worktree cleanup failed: ${message}`,
            worktreePath,
          };
        }

        return {
          ...result,
          integrationStatus: 'applied',
          changedFiles: integrationResult.changedFiles,
          worktreePath,
        };
      }

      if (integrationResult.conflict) {
        // SC-12 / rule 6: retain conflicted worktrees.
        await retain(worktreePath, `conflict: ${integrationResult.conflictFiles.join(', ')}`);
        return {
          ...result,
          integrationStatus: 'conflict',
          error: `integration conflict in: ${integrationResult.conflictFiles.join(', ')}`,
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
      const message = error instanceof Error ? error.message : String(error);
      // Unexpected error during integration: retain and mark as failed.
      await retain(worktreePath, `integration exception: ${message}`);
      return {
        ...result,
        integrationStatus: 'failed',
        error: message,
        worktreePath,
      };
    } finally {
      slot.release();
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
