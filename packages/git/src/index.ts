/** @piwin/git — modular git read/write models. */

export { runGitCommand, GitCommandError } from './git-command-runner.js';
export type {
  GitCommandErrorKind,
  GitCommandResult,
  RunGitCommandOptions,
} from './git-command-runner.js';

export {
  createTurnChangeObjectStore,
  DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES,
} from './turn-changes/object-store.js';
export type {
  TurnChangeObjectPutResult,
  TurnChangeObjectStore,
} from './turn-changes/object-store.js';

export { openTurnChangeStore } from './turn-changes/store.js';
export type {
  TurnChangeFileActionRecord,
  TurnChangeRunSegmentRecord,
  TurnChangeStore,
} from './turn-changes/store.js';

export { persistTurnChangeWriteReceipt } from './turn-changes/capture.js';

export { freezeWorktreeAgainstBase } from './turn-changes/freeze-tree.js';
export type { FrozenWorktreeSnapshot } from './turn-changes/freeze-tree.js';

export { composeFileActions } from './turn-changes/compose.js';
export type { ComposedFileAction, ComposeCoverage } from './turn-changes/compose.js';

export { diffTurnChangeObjects } from './turn-changes/content-diff.js';

export {
  resolveTurnChangePath,
  assertWritableTurnChangeFile,
  canonicalizeForContainment,
  resolveFileLockKey,
} from './turn-changes/path-policy.js';
export type {
  TurnChangePathKind,
  ResolvedTurnChangePath,
  FileLockKeyFailure,
} from './turn-changes/path-policy.js';

export { readHeadFiles, findContentFilteredPaths } from './turn-changes/head-blob.js';
export type { HeadFileLookup } from './turn-changes/head-blob.js';

export { writeTurnChangeFile, deleteTurnChangeFile } from './turn-changes/file-writer.js';
export type { TurnChangeWriteReceipt } from './turn-changes/file-writer.js';

export { planUndoRedo } from './turn-changes/operation-plan.js';
export type { PlannedFileOp } from './turn-changes/operation-plan.js';

export { runTurnChangeOperation } from './turn-changes/operation-runner.js';
export type { TurnChangeOperationRunResult } from './turn-changes/operation-runner.js';
export { collectMismatchedPaths, precheckTurnChangeOperation } from './turn-changes/precheck.js';
export type { TurnChangePrecheckReason, TurnChangePrecheckResult } from './turn-changes/precheck.js';
export { findIndexBlockedPaths } from './turn-changes/git-safety.js';
export {
  createTurnChangeStorageBudget,
  DEFAULT_TURN_CHANGE_STORAGE_BUDGET_BYTES,
} from './turn-changes/storage-budget.js';
export type { TurnChangeStorageBudget } from './turn-changes/storage-budget.js';
export { exportTurnChangeBackup, TurnChangeBackupExportError } from './turn-changes/export-backup.js';
export type {
  TurnChangeBackupExportRefusal,
  TurnChangeBackupManifest,
} from './turn-changes/export-backup.js';

export type {
  TurnChangeVersionFile,
  TurnChangeVersionRecord,
} from './turn-changes/version-store.js';

export type {
  TurnChangeSealStore,
  TurnChangeShellAudit,
  TurnChangeVersionNote,
} from './turn-changes/seal-store.js';
export { recoverTurnChangeOperation } from './turn-changes/recovery.js';
export {
  previewTurnChangeRepair,
  runTurnChangeRepair,
  verifyTurnChangeRepair,
} from './turn-changes/operation-repair.js';
export type {
  TurnChangeRepairFile,
  TurnChangeRepairPreviewResult,
  TurnChangeRepairRunResult,
  TurnChangeRepairState,
} from './turn-changes/operation-repair.js';
export type {
  TurnChangeOperationLogRow,
  TurnChangeOperationLogStore,
  TurnChangeOperationNote,
  TurnChangeStuckOperation,
} from './turn-changes/operation-log-store.js';
export type {
  TurnChangeNoticeStore,
  TurnChangePendingNotice,
} from './turn-changes/notice-store.js';
export type {
  TurnChangeConflictStore,
  TurnChangeLaterTurnRecord,
} from './turn-changes/conflict-store.js';
export {
  DEFAULT_TURN_CHANGE_OBJECT_GRACE_MS,
  DEFAULT_TURN_CHANGE_RETENTION_MS,
  sweepTurnChangeRetention,
} from './turn-changes/retention.js';
export type { TurnChangeRetentionResult } from './turn-changes/retention.js';
export type { TurnChangeRetentionStore } from './turn-changes/retention-store.js';
export type {
  SubagentApplyReservationRecord,
  SubagentApplyReserveResult,
  TurnChangeBeginOperationResult,
  TurnChangeOperationFileRecord,
  TurnChangeOperationKind,
  TurnChangeOperationRecord,
} from './turn-changes/operation-store.js';
export {
  occupiesSubagentApplyStatus,
  SUBAGENT_APPLY_RESOURCE_PRINCIPAL,
  subagentApplyGroupKey,
  subagentApplyResultKey,
  subagentApplyWriteCompletedKey,
} from './turn-changes/operation-store.js';

export { probeGitRepository } from './repository-probe.js';

export { parsePorcelainStatus, parsePorcelainFileLine } from './status-parser.js';
export type { ParsedGitStatus } from './status-parser.js';

export { readGitStatus } from './status-reader.js';
export type { ReadGitStatusOptions } from './status-reader.js';

export {
  readGitBranchList,
  parseGitBranchListOutput,
  excludeStaleMergedBranches,
} from './branch-list.js';
export type { ReadGitBranchListOptions } from './branch-list.js';

export {
  listGitWorktrees,
  parseGitWorktreeListPorcelain,
  annotateBranchesWithWorktreeOccupancy,
} from './worktree-list.js';

export { formatGitCheckoutFailure } from './checkout-failure.js';

export {
  findRegisteredGitWorktreeRoot,
  findTrustedSameRepositoryRoot,
  resolveGitCommonDir,
  resolveOpenGitWorkspacePath,
} from './same-repository.js';

export {
  gitRepositoryIdFromCommonDir,
  readGitWorkspaceListing,
} from './workspace-listing.js';
export type { GitWorkspaceListing } from './workspace-listing.js';

export {
  readGitDiffSummary,
  parseNumstat,
  parseNameStatus,
  mergeDiffSummaryFiles,
} from './diff-summary.js';
export type {
  ReadGitDiffSummaryOptions,
  GitNumstatRow,
  GitNameStatusRow,
} from './diff-summary.js';

export { readGitFileDiff, countPatchStats } from './file-diff.js';
export type { ReadGitFileDiffOptions } from './file-diff.js';

export { readGitCommitGraph, parseGitLogRecords } from './commit-graph.js';
export type { ReadGitCommitGraphOptions } from './commit-graph.js';

export {
  assertSafeRepoRelativePaths,
  assertSafeBranchName,
  assertSafeRef,
  assertSafeCommitMessage,
} from './path-safety.js';

export {
  evaluateGitStagePolicy,
  evaluateGitCommitPolicy,
  evaluateGitBranchPolicy,
  evaluateGitCheckoutPolicy,
} from './mutation-policy.js';
export type { GitMutationPolicyEvaluation } from './mutation-policy.js';

export {
  stagePaths,
  unstagePaths,
  commitChanges,
  createBranch,
  checkoutRef,
} from './mutations.js';

export { createGitService } from './git-service.js';
export type { GitService } from './git-service.js';

export {
  createWorktree,
  removeWorktree,
  diffWorktreeAgainstMain,
  worktreeDisplayName,
  worktreeRepositoryKey,
  subagentWorktreeBranch,
  resetWorktreeToBase,
  isWorktreeUsable,
} from './worktree.js';
export type {
  CreateWorktreeInput,
  CreateWorktreeResult,
  RemoveWorktreeInput,
  DiffWorktreeInput,
  DiffWorktreeResult,
  ResetWorktreeInput,
} from './worktree.js';

export {
  integrateWorktreeChanges,
  integrateSnapshotChanges,
  readChildPatchFromWorktree,
  readChildPatchFromTree,
  applyChildPatchToParent,
  isWorktreeBaseClean,
} from './worktree-integration.js';
export type {
  ChildChangePatch,
  SnapshotIntegrationInput,
  WorktreeIntegrationInput,
  WorktreeIntegrationResult,
} from './worktree-integration.js';

export {
  writeWorktreeResultTree,
  commitResultSnapshot,
  deleteResultSnapshotRef,
  checkoutWorktreeTree,
  resultSnapshotRefName,
} from './turn-changes/git-snapshot.js';
