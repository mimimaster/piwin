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
  | 'foreign-host-active'
  | 'stale-revision'
  | 'files-changed'
  | 'staged-paths'
  | 'git-baseline-changed'
  | 'backup-failed'
  | 'needs-repair'
  | 'permission-denied'
  | 'direction-unavailable'
  /** The turn is still running or its record is not sealed yet. */
  | 'capture-pending'
  /** The sealed turn changed no files. */
  | 'no-changes';

/** Why a sealed version cannot be undone automatically. */
export type TurnChangeIncompleteReason =
  /** A command changed a file this turn also wrote through Host tools. */
  | 'command-overlap'
  /** A command ran but its effect on the workspace could not be audited. */
  | 'command-unaudited'
  /** A file's recorded writes do not chain (something else wrote between them). */
  | 'chain-broken'
  /** A Host write could not be recorded. */
  | 'capture-failed'
  /** Tool executions were still unsettled when sealing gave up waiting. */
  | 'capture-timeout';

export type TurnChangeAvailability =
  | { allowed: true }
  | { allowed: false; reason: TurnChangeBlockReason; affectedPaths?: string[] };

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
  /** Files commands changed this turn that undo leaves alone (workspace-relative). */
  excludedPaths?: string[];
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

/** One file's change in a sealed version: before → after, never the current file. */
export type TurnChangeFileDiff = TurnChangeFileEntry & {
  changeSetId: string;
  revision: number;
  /** Unified patch; omitted for binary content. */
  patch?: string;
};

export type TurnChangeCheck = {
  changeSetId: string;
  revision: number;
  direction: TurnChangeDirection;
  availability: TurnChangeAvailability;
};
