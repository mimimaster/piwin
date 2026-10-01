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
  | 'writer-slot'
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

/**
 * A linked worktree of a repository the product delegates in, created by
 * someone else (the user, or an agent running `git worktree add`). The GC does
 * not own it and never removes it; it is listed so leftovers do not stay
 * invisible just because they sit outside the product's storage root.
 */
export type SubagentForeignWorktree = {
  worktreePath: string;
  /** Checked-out branch; null for a detached HEAD. */
  branch: string | null;
  parentRepoPath: string;
};

export type SubagentWorktreeGcPreview = {
  entries: SubagentWorktreeGcEntry[];
  totalBytes: number;
  reclaimableBytes: number;
  reclaimableCount: number;
  /** Read-only: worktrees outside the product's storage root. */
  foreign?: SubagentForeignWorktree[];
};

export type SubagentWorktreeGcResult = {
  removedCount: number;
  removedBytes: number;
  failed: Array<{ worktreePath: string; error: string }>;
};
