/** Turn-change summary and availability contracts. Storage is owned by later Host tasks. */

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
  | 'direction-unavailable';

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
};
