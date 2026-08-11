/**
 * CE-SUB-ORCH: workspace service for subagent isolation.
 *
 * Allocates workspace leases (readonly or worktree) for the orchestrator.
 * Readonly tasks use the parent working directory directly. Worktree tasks
 * apply the explicit dirty-base consent policy, create one worktree per child,
 * and retain failed/conflicted worktrees
 * for inspection.
 */

import type { SubagentTaskSpec, SubagentWorkspaceLease } from '@piwin/contracts';
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
};

export function createSubagentWorkspaceService(options: SubagentWorkspaceServiceOptions): {
  acquire(task: SubagentTaskSpec): Promise<SubagentWorkspaceLease>;
  release(lease: SubagentWorkspaceLease): Promise<void>;
} {
  const { projectPath, parallelWritePolicy } = options;

  async function acquire(task: SubagentTaskSpec): Promise<SubagentWorkspaceLease> {
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

    return {
      mode: 'worktree',
      cwd: worktree.worktreePath,
      parentRepoPath: taskProjectPath,
      worktreePath: worktree.worktreePath,
      worktreeBranch: worktree.branch,
      baseCommit,
    };
  }

  async function release(lease: SubagentWorkspaceLease): Promise<void> {
    // Readonly leases have nothing to release.
    if (lease.mode === 'readonly') return;
    // Integration owns worktree cleanup because it knows whether the result
    // was applied successfully or must be retained for inspection.
  }

  return { acquire, release };
}
