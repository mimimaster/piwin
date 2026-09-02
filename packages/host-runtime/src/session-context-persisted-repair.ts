import {
  contextBoundaryCompatible,
  type ContextBoundary,
  type SessionContextSnapshot,
} from '@piwin/contracts';
import { occupancyEqual } from './session-context-merge.js';

/**
 * One-shot demotion of persisted cross-generation occupancy pollution. The
 * old idle+known copied value and the two legacy idle+unknown shapes keep
 * `lastConfirmed` for presentation-only display; contextVersion is not
 * bumped.
 */
export function repairPersistedCrossLeafKnownPollution(
  snapshot: SessionContextSnapshot,
): SessionContextSnapshot {
  if (
    !isOldPatchCrossLeafKnownPollution(snapshot) &&
    !isIdleCrossLeafUnknownWithStaleOccupancy(snapshot)
  ) {
    return snapshot;
  }
  const repaired: SessionContextSnapshot = {
    ...snapshot,
    phase: 'invalidated',
    occupancy: { kind: 'unknown', reason: 'runtime-generation-mismatch' },
  };
  delete repaired.coveredMessageId;
  delete repaired.coveredRequestId;
  return repaired;
}

/**
 * A failed rebind or interrupted response can leave the later terminal
 * transition as idle while its occupancy still describes the previous
 * generation (or a response that never completed). Normalize it before
 * resume so the Desktop stale-ring projection can take its explicit
 * invalidated path instead of hiding an otherwise useful last confirmation.
 */
function isIdleCrossLeafUnknownWithStaleOccupancy(snapshot: SessionContextSnapshot): boolean {
  if (snapshot.phase !== 'idle') {
    return false;
  }
  if (
    snapshot.occupancy.kind !== 'unknown' ||
    (snapshot.occupancy.reason !== 'runtime-generation-mismatch' &&
      snapshot.occupancy.reason !== 'waiting-for-response')
  ) {
    return false;
  }
  if (snapshot.runId !== undefined || snapshot.responseEvidence.currentRunHasResponse) {
    return false;
  }
  if (!snapshot.responseEvidence.historyHasDisplayableResponse) {
    return false;
  }
  const lastConfirmed = snapshot.lastConfirmed;
  if (lastConfirmed === undefined || lastConfirmed.occupancy.kind !== 'known') {
    return false;
  }
  const currentLeaf = snapshot.contextBoundary.activeLeafMessageId;
  const lastLeaf = lastConfirmed.contextBoundary.activeLeafMessageId;
  if (
    currentLeaf === null ||
    currentLeaf.length === 0 ||
    lastLeaf === null ||
    lastLeaf.length === 0 ||
    currentLeaf === lastLeaf
  ) {
    return false;
  }
  return nonLeafBoundaryCompatible(lastConfirmed.contextBoundary, snapshot.contextBoundary);
}

function isOldPatchCrossLeafKnownPollution(snapshot: SessionContextSnapshot): boolean {
  if (snapshot.phase !== 'idle') {
    return false;
  }
  if (snapshot.occupancy.kind !== 'known') {
    return false;
  }
  const lastConfirmed = snapshot.lastConfirmed;
  if (lastConfirmed === undefined) {
    return false;
  }
  if (!occupancyEqual(snapshot.occupancy, lastConfirmed.occupancy)) {
    return false;
  }
  if (snapshot.runId !== undefined) {
    return false;
  }
  if (snapshot.responseEvidence.currentRunHasResponse) {
    return false;
  }
  if (!snapshot.responseEvidence.historyHasDisplayableResponse) {
    return false;
  }
  const currentLeaf = snapshot.contextBoundary.activeLeafMessageId;
  if (currentLeaf === null || currentLeaf.length === 0) {
    return false;
  }
  const lastLeaf = lastConfirmed.contextBoundary.activeLeafMessageId;
  if (currentLeaf === lastLeaf) {
    return false;
  }
  if (snapshot.coveredMessageId !== lastLeaf) {
    return false;
  }
  if (snapshot.coveredMessageId === currentLeaf) {
    return false;
  }
  return nonLeafBoundaryCompatible(lastConfirmed.contextBoundary, snapshot.contextBoundary);
}

/** Moved leaf is the pollution signal; other boundary axes must still match. */
function nonLeafBoundaryCompatible(
  lastConfirmedBoundary: ContextBoundary,
  currentBoundary: ContextBoundary,
): boolean {
  return contextBoundaryCompatible(
    { ...lastConfirmedBoundary, activeLeafMessageId: currentBoundary.activeLeafMessageId },
    currentBoundary,
  );
}
