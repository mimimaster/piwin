/**
 * Host-owned leftover worktree inventory and GC (not a skill).
 *
 * Failed, cancelled, paused, and crashed subagent runs retain their
 * worktrees for inspection. Cleanup has to see Host state the model cannot:
 * pending apply, conflict, user retain, unfrozen snapshots, and unused
 * pause checkpoints. Auto GC also waits 7 days; a confirmed UI cleanup
 * skips that wait but keeps every other guard, plus a short in-flight grace.
 */

export const SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Covers worktree create → lease persist so GC cannot race a live allocate. */
export const SUBAGENT_WORKTREE_GC_GRACE_MS = 2 * 60 * 1000;

export type SubagentWorktreeGcMode = 'auto' | 'manual';

export type SubagentWorktreeGcKeepReason =
  | 'running'
  | 'pending-integration'
  | 'conflict'
  | 'user-retained'
  | 'unfrozen-snapshot'
  | 'pause-checkpoint'
  | 'too-recent'
  | 'locked'
  | 'unsafe-path';

export type SubagentWorktreeGcEntry = {
  worktreePath: string;
  parentRepoPath?: string;
  worktreeBranch?: string;
  runId?: string;
  taskId?: string;
  parentSessionId?: string;
  bytes: number;
  mtimeMs: number;
  orphan: boolean;
  reclaimable: boolean;
  keepReasons: SubagentWorktreeGcKeepReason[];
};

export type SubagentWorktreeGcPreview = {
  entries: SubagentWorktreeGcEntry[];
  totalBytes: number;
  reclaimableBytes: number;
  reclaimableCount: number;
};

export type SubagentWorktreeGcResult = {
  removedCount: number;
  removedBytes: number;
  failed: Array<{ worktreePath: string; error: string }>;
};
