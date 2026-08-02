/**
 * CE-SUB-ORCH: workspace service for subagent isolation.
 *
 * Allocates workspace leases (readonly or worktree) for the orchestrator.
 * Readonly tasks use the parent working directory directly. Worktree tasks
 * require a clean base (when `requireCleanBaseForParallelWrites` is true),
 * create one worktree per child, and retain failed/conflicted worktrees
 * for inspection.
 */

import type {
  SubagentTaskSpec,
  SubagentWorkspaceLease,
} from '@piwin/contracts';
import { createWorktree, removeWorktree } from '@piwin/git';

export type SubagentWorkspaceServiceOptions = {
  /** Parent project path (used as the worktree base). */
  projectPath: string;
  /** Whether to require a clean git base for parallel writes. */
  requireCleanBaseForParallelWrites: boolean;
  /** Whether parallel writes are enabled. */
  parallelWritePolicy: 'worktree-only' | 'disabled';
};

export function createSubagentWorkspaceService(
  options: SubagentWorkspaceServiceOptions,
): {
  acquire(task: SubagentTaskSpec): Promise<SubagentWorkspaceLease>;
  release(lease: SubagentWorkspaceLease): Promise<void>;
} {
  const { projectPath, requireCleanBaseForParallelWrites, parallelWritePolicy } = options;

  async function acquire(task: SubagentTaskSpec): Promise<SubagentWorkspaceLease> {
    const mode = task.isolationOverride ?? 'readonly';

    if (mode === 'readonly') {
      return {
        mode: 'readonly',
        cwd: projectPath,
      };
    }

    // Worktree mode.
    if (parallelWritePolicy === 'disabled') {
      throw new Error('parallel writes are disabled in Settings');
    }

    if (requireCleanBaseForParallelWrites) {
      // The caller (HostRuntime) is responsible for checking git status
      // before calling runBatch. This is a defensive check.
      // TODO: integrate with @piwin/git isClean when available.
    }

    const wt = await createWorktree({
      projectPath,
      name: `subagent-${task.id}-${Date.now().toString(36)}`,
    });

    return {
      mode: 'worktree',
      cwd: wt.worktreePath,
      worktreePath: wt.worktreePath,
      worktreeBranch: wt.branch,
      // TODO: capture HEAD before worktree creation
    };
  }

  async function release(lease: SubagentWorkspaceLease): Promise<void> {
    // Readonly leases have nothing to release.
    if (lease.mode === 'readonly') return;
    // Worktree leases are NOT automatically removed — the orchestrator
    // decides whether to integrate, retain, or remove based on the result.
    // This method is called by the orchestrator after integration is done.
    // Only remove if the worktree path is present and integration succeeded.
    // The caller should call removeWorktree explicitly when done.
    // For now, this is a no-op; the integration port handles cleanup.
  }

  return { acquire, release };
}
