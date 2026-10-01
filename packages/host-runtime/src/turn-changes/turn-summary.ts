/**
 * The client-facing summary of one turn's change set: counts, state, and
 * whether undo / redo are available right now (before touching disk — the
 * file-level check is `turn-changes/check`, and undo re-verifies anyway).
 */
import type {
  TurnChangeAvailability,
  TurnChangeCaptureState,
  TurnChangeDisposition,
  TurnChangeIncompleteReason,
  TurnChangeSummary,
} from '@piwin/contracts';
import type { TurnChangeStore } from '@piwin/git';
import { DEFAULT_TURN_CHANGE_RETENTION_MS } from '@piwin/git';

const INCOMPLETE_REASONS = new Set<TurnChangeIncompleteReason>([
  'command-overlap',
  'command-unaudited',
  'chain-broken',
  'capture-failed',
  'capture-timeout',
  'storage-full',
]);

function toCaptureState(value: string): TurnChangeCaptureState {
  return value === 'ready' || value === 'incomplete' || value === 'expired' || value === 'settling'
    ? value
    : 'collecting';
}

function toDisposition(value: string): TurnChangeDisposition {
  return value === 'applied' || value === 'undone' ? value : 'unknown';
}

function toIncompleteReason(value: string | null | undefined): TurnChangeIncompleteReason | null {
  return value && INCOMPLETE_REASONS.has(value as TurnChangeIncompleteReason)
    ? (value as TurnChangeIncompleteReason)
    : null;
}

/** When the retention sweep may expire this turn: its last run end + the window. */
function expiresAtFor(store: TurnChangeStore, runIds: readonly string[], expired: boolean): string | null {
  if (expired || runIds.length === 0) return null;
  let lastEnd = 0;
  for (const runId of runIds) {
    const endedAt = store.getRunSegment(runId)?.endedAt;
    if (!endedAt) return null;
    lastEnd = Math.max(lastEnd, Date.parse(endedAt));
  }
  return Number.isFinite(lastEnd) && lastEnd > 0
    ? new Date(lastEnd + DEFAULT_TURN_CHANGE_RETENTION_MS).toISOString()
    : null;
}

/** What the undo that made this turn `undone` left alone (command-created files that changed since). */
function leftInPlacePaths(
  store: TurnChangeStore,
  disposition: TurnChangeDisposition,
  latest: { operationId: string; kind: string; status: string } | undefined,
): string[] {
  if (disposition !== 'undone' || latest?.kind !== 'undo' || latest.status !== 'succeeded') {
    return [];
  }
  return [...(store.getOperationNote(latest.operationId)?.skippedPaths ?? [])];
}

export function buildTurnChangeSummary(
  store: TurnChangeStore,
  changeSetId: string,
  latestOperationId: string | null = null,
): TurnChangeSummary | undefined {
  const attempt = store.getAttempt(changeSetId);
  if (!attempt) {
    return undefined;
  }
  const captureState = toCaptureState(attempt.captureState);
  const disposition = toDisposition(attempt.disposition);
  const latestOperation = store.getLatestChangeSetOperation(changeSetId);
  const runIds = store.listRunIdsByAttempt(attempt.attemptId);
  const version =
    attempt.activeRevision > 0
      ? store.getChangeVersion(changeSetId, attempt.activeRevision)
      : undefined;
  const note =
    attempt.activeRevision > 0 ? store.getVersionNote(changeSetId, attempt.activeRevision) : undefined;

  const blocked = (
    reason: Extract<TurnChangeAvailability, { allowed: false }>['reason'],
  ): TurnChangeAvailability => ({ allowed: false, reason });
  let base: TurnChangeAvailability | null = null;
  if (captureState === 'expired') {
    base = blocked('data-expired');
  } else if (latestOperation?.status === 'needs-repair') {
    // A half-applied undo/redo blocks both directions until repaired.
    base = blocked('needs-repair');
  } else if (latestOperation?.status === 'applying') {
    base = blocked('workspace-restoring');
  } else if (captureState === 'collecting' || captureState === 'settling') {
    base = blocked('capture-pending');
  } else if (!version) {
    // Recorded before sealing existed: marked incomplete, never versioned.
    base = blocked(captureState === 'incomplete' ? 'capture-incomplete' : 'capture-pending');
  } else if (!version.coverageComplete) {
    base = blocked('capture-incomplete');
  } else if (version.fileCount === 0) {
    base = blocked('no-changes');
  }
  const undo =
    base ?? (disposition === 'applied' ? { allowed: true as const } : blocked('direction-unavailable'));
  const redo =
    base ?? (disposition === 'undone' ? { allowed: true as const } : blocked('direction-unavailable'));

  return {
    changeSetId,
    attemptId: attempt.attemptId,
    sessionId: attempt.sessionId,
    workspaceId: attempt.workspaceId,
    userMessageId: attempt.userMessageId,
    runIds,
    revision: attempt.activeRevision,
    captureState,
    disposition,
    fileCount: version?.fileCount ?? null,
    additions: version?.additions ?? null,
    deletions: version?.deletions ?? null,
    binaryFileCount: version?.binaryFileCount ?? 0,
    coverageComplete: version?.coverageComplete ?? false,
    undo,
    redo,
    expiresAt: expiresAtFor(store, runIds, captureState === 'expired'),
    latestOperationId: latestOperationId ?? latestOperation?.operationId ?? null,
    incompleteReason: toIncompleteReason(note?.incompleteReason),
    excludedPaths: [...(note?.excludedPaths ?? [])],
    overlappingPaths: [...(note?.overlappingPaths ?? [])],
    leftInPlacePaths: leftInPlacePaths(store, disposition, latestOperation),
  };
}
