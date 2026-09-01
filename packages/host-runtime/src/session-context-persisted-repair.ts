import {
  contextBoundaryCompatible,
  type ContextBoundary,
  type SessionContextSnapshot,
} from '@piwin/contracts';
import { occupancyEqual } from './session-context-merge.js';

/**
 * One-shot demotion of idle+known rows left by the old hydrate promotion patch
 * when lastConfirmed occupancy was copied across a moved leaf. lastConfirmed is
 * kept for presentation-only display; contextVersion is not bumped.
 */
export function repairPersistedCrossLeafKnownPollution(
  snapshot: SessionContextSnapshot,
): SessionContextSnapshot {
  if (!isOldPatchCrossLeafKnownPollution(snapshot)) {
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
