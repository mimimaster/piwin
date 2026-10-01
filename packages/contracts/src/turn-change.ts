/** Turn-change summary and availability contracts; storage and sealing live in the Host. */

export type TurnChangeCaptureState = 'collecting' | 'settling' | 'ready' | 'incomplete' | 'expired';
export type TurnChangeDisposition = 'applied' | 'undone' | 'unknown';
export type TurnChangeDirection = 'undo' | 'redo';

export type TurnChangeBlockReason =
  | 'unsupported-workspace'
  | 'capture-incomplete'
  | 'data-expired'
  | 'workspace-busy'
  | 'workspace-restoring'
  | 'stale-revision'
  | 'files-changed'
  /** An affected path has staged or unmerged entries in the Git index. */
  | 'staged-paths'
  /** The pre-operation backup could not be stored; nothing was written. */
  | 'backup-failed'
  | 'needs-repair'
  /** An affected path could not be read or written (EACCES / EPERM). */
  | 'permission-denied'
  | 'direction-unavailable'
  /** The turn is still running or its record is not sealed yet. */
  | 'capture-pending'
  /** The sealed turn changed no files. */
  | 'no-changes';

/** Why a sealed version cannot be undone automatically. */
export type TurnChangeIncompleteReason =
  /** A command changed a file this turn also wrote through Host tools, and Host could not image it. */
  | 'command-overlap'
  /** A command ran but its effect on the workspace could not be audited. */
  | 'command-unaudited'
  /** A file's recorded writes do not chain (something else wrote between them). */
  | 'chain-broken'
  /** A Host write could not be recorded. */
  | 'capture-failed'
  /** Tool executions were still unsettled when sealing gave up waiting. */
  | 'capture-timeout'
  /** The undo store was over its size budget, so this turn's writes were not kept. */
  | 'storage-full';

/** A later turn in the same workspace that changed a path after this turn. */
export type TurnChangeLaterTurn = {
  changeSetId: string;
  sessionId: string;
  runIds: string[];
  /** When that turn's record was sealed; null when unknown. */
  endedAt: string | null;
};

/**
 * Who changed one blocked path after the turn. An empty `laterTurns` means
 * the source is unknown (an editor, a command, another tool) — never guessed.
 */
export type TurnChangePathConflict = {
  relativePath: string;
  laterTurns: TurnChangeLaterTurn[];
};

export type TurnChangeAvailability =
  | { allowed: true }
  | {
      allowed: false;
      reason: TurnChangeBlockReason;
      affectedPaths?: string[];
      /** With `files-changed`: per blocked path, the later turns that touched it. */
      conflicts?: TurnChangePathConflict[];
    };

export type TurnChangeSummary = {
  changeSetId: string;
  attemptId: string;
  sessionId: string;
  workspaceId: string;
  userMessageId: string | null;
  runIds: string[];
  revision: number;
  captureState: TurnChangeCaptureState;
  disposition: TurnChangeDisposition;
  fileCount: number | null;
  additions: number | null;
  deletions: number | null;
  binaryFileCount: number;
  coverageComplete: boolean;
  undo: TurnChangeAvailability;
  redo: TurnChangeAvailability;
  expiresAt: string | null;
  latestOperationId: string | null;
  /** Set when `coverageComplete` is false. */
  incompleteReason?: TurnChangeIncompleteReason | null;
  /**
   * Files a command changed that Host could not image (workspace-relative).
   * Undo leaves them alone; a file here that the turn also wrote makes the
   * turn incomplete (see `overlappingPaths`).
   */
  excludedPaths?: string[];
  /**
   * With `incompleteReason: 'command-overlap'`: the files a command changed
   * that the turn also wrote through Host tools, and that could not be
   * chained — the ones that block undo.
   */
  overlappingPaths?: string[];
  /**
   * With `disposition: 'undone'`: files only commands created that changed
   * after the turn, so the undo left them in place instead of refusing.
   */
  leftInPlacePaths?: string[];
};

export type TurnChangeFileEntry = {
  fileId: string;
  relativePath: string;
  kind: 'added' | 'modified' | 'deleted';
  /** Null for binary content. */
  additions: number | null;
  deletions: number | null;
  binary: boolean;
};

export type TurnChangeFilePage = {
  changeSetId: string;
  revision: number;
  files: TurnChangeFileEntry[];
  nextCursor: string | null;
};

/**
 * One file's change in a sealed version. `sealed` (default): before → after,
 * never the current file. `current`: the turn's result → the file on disk now,
 * only for looking at a conflict.
 */
export type TurnChangeDiffBase = 'sealed' | 'current';

export type TurnChangeFileDiff = TurnChangeFileEntry & {
  changeSetId: string;
  revision: number;
  /** Which comparison `patch` holds; omitted means `sealed`. */
  against?: TurnChangeDiffBase;
  /** With `current`: the file no longer exists on disk. */
  currentMissing?: boolean;
  /** Unified patch; omitted for binary content. */
  patch?: string;
};

export type TurnChangeCheck = {
  changeSetId: string;
  revision: number;
  direction: TurnChangeDirection;
  availability: TurnChangeAvailability;
};

/**
 * Lifecycle of one undo/redo. `applying` covers pre-check through the last
 * verified write; a mid-write failure rolls back (`rolled-back`) or, when the
 * rollback itself cannot finish, stops at `needs-repair` until the repair
 * commands put every path back.
 */
export type TurnChangeOperationStatus =
  | 'applying'
  | 'succeeded'
  | 'rejected'
  | 'cancelled'
  | 'rolled-back'
  | 'needs-repair';

/** One entry in a workspace's undo/redo record (`turn-changes/operations`). */
export type TurnChangeOperationEntry = {
  operationId: string;
  changeSetId: string;
  sessionId: string;
  workspaceId: string;
  direction: TurnChangeDirection;
  status: TurnChangeOperationStatus;
  /** Change-set revision the operation targeted. */
  revision: number;
  /** Files the operation covered (its turn's count when a pre-check rejected it). */
  fileCount: number;
  /** Null for operations recorded before timestamps existed. */
  createdAt: string | null;
  updatedAt: string | null;
  /** Why it did not succeed, when known (`files-changed`, `write-failed`, …). */
  reason?: string;
  /** The operation is no longer the change set's latest; its actions are stale. */
  superseded: boolean;
  /** Current state of the turn it belongs to, for 恢复改动 and expiry. */
  summary: TurnChangeSummary | null;
};

export type TurnChangeOperationPage = {
  workspaceId: string;
  operations: TurnChangeOperationEntry[];
  nextCursor: string | null;
};

/**
 * Where one path of a stuck operation stands now: already back to its
 * pre-operation bytes, still holding what the operation wrote (safe to
 * restore), or something else (never overwritten automatically).
 */
export type TurnChangeRepairPathState = 'restored' | 'operation-content' | 'foreign';

export type TurnChangeRepairPreview = {
  operationId: string;
  changeSetId: string;
  revision: number;
  status: TurnChangeOperationStatus;
  files: Array<{ relativePath: string; state: TurnChangeRepairPathState }>;
  /** Pass to `recovery-run`; it refuses when the files moved since this preview. */
  confirmationToken: string;
};

/** Files written so far by a running undo/redo. */
export type TurnChangeOperationProgress = { done: number; total: number };

/**
 * A copy of one operation's pre-operation backup, written under a new
 * directory on the Host machine; the workspace is never touched.
 */
export type TurnChangeBackupExport = {
  operationId: string;
  /** The new directory that holds the copies and `manifest.json`. */
  destination: string;
  exportedPaths: string[];
};
