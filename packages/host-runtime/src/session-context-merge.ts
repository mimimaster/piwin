import {
  contextBoundaryCompatible,
  formatCompactionBoundary,
  promoteLastConfirmed,
  type ContextBoundary,
  type ContextMeasurement,
  type ContextOccupancy,
  type SessionContextSnapshot,
} from '@piwin/contracts';

export function occupancyEqual(left: ContextOccupancy, right: ContextOccupancy): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'unknown' && right.kind === 'unknown') {
    return left.reason === right.reason;
  }
  if (left.kind === 'known' && right.kind === 'known') {
    return (
      left.tokensUsed === right.tokensUsed &&
      left.tokensLimit === right.tokensLimit &&
      left.quality === right.quality &&
      left.coverage === right.coverage &&
      left.basis === right.basis &&
      left.sampledAt === right.sampledAt
    );
  }
  return false;
}

function modelRefEqual(left: ContextBoundary['model'], right: ContextBoundary['model']): boolean {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  return (
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.protocol === right.protocol &&
    left.source === right.source
  );
}

function contextBoundaryEqual(left: ContextBoundary, right: ContextBoundary): boolean {
  return (
    left.activeLeafMessageId === right.activeLeafMessageId &&
    left.compactionBoundary === right.compactionBoundary &&
    left.capabilityFingerprint === right.capabilityFingerprint &&
    left.seedFingerprint === right.seedFingerprint &&
    modelRefEqual(left.model, right.model)
  );
}

function lastConfirmedEqual(
  left: SessionContextSnapshot['lastConfirmed'],
  right: SessionContextSnapshot['lastConfirmed'],
): boolean {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  return (
    occupancyEqual(left.occupancy, right.occupancy) &&
    contextBoundaryEqual(left.contextBoundary, right.contextBoundary) &&
    left.sampledAt === right.sampledAt
  );
}

/** Persist-state equality. Ignores revision/updatedAt bookkeeping only. */
export function snapshotPersistEqual(
  left: SessionContextSnapshot,
  right: SessionContextSnapshot,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.contextVersion === right.contextVersion &&
    left.phase === right.phase &&
    left.runId === right.runId &&
    left.runtimeGenerationId === right.runtimeGenerationId &&
    left.coveredMessageId === right.coveredMessageId &&
    left.coveredRequestId === right.coveredRequestId &&
    occupancyEqual(left.occupancy, right.occupancy) &&
    contextBoundaryEqual(left.contextBoundary, right.contextBoundary) &&
    left.responseEvidence.currentRunHasResponse === right.responseEvidence.currentRunHasResponse &&
    left.responseEvidence.historyHasDisplayableResponse ===
      right.responseEvidence.historyHasDisplayableResponse &&
    left.responseEvidence.evidenceMessageId === right.responseEvidence.evidenceMessageId &&
    lastConfirmedEqual(left.lastConfirmed, right.lastConfirmed)
  );
}

export function isBlockedOccupancy(occupancy: ContextOccupancy): boolean {
  if (occupancy.kind === 'unknown') {
    return true;
  }
  if (occupancy.tokensUsed !== 0) {
    return false;
  }
  return /error|abort|zero/i.test(occupancy.basis);
}

export function boundaryCompatible(current: ContextBoundary, incoming: ContextBoundary): boolean {
  return contextBoundaryCompatible(current, incoming);
}

export function activationBoundaryMatches(
  current: ContextBoundary,
  incoming: ContextBoundary,
): boolean {
  return (
    boundaryCompatible(current, incoming) &&
    current.activeLeafMessageId === incoming.activeLeafMessageId
  );
}

function blockedReason(occupancy: ContextOccupancy): string {
  if (occupancy.kind === 'unknown') {
    return occupancy.reason;
  }
  return occupancy.basis;
}

function stampOwner(
  snapshot: SessionContextSnapshot,
  input: { runId?: string; runtimeGenerationId?: string; messageId?: string },
): SessionContextSnapshot {
  const next: SessionContextSnapshot = { ...snapshot };
  if (input.runId !== undefined) next.runId = input.runId;
  if (input.runtimeGenerationId !== undefined) next.runtimeGenerationId = input.runtimeGenerationId;
  if (input.messageId !== undefined) next.coveredMessageId = input.messageId;
  return next;
}

export function applyMeasurement(
  snapshot: SessionContextSnapshot,
  measurement: ContextMeasurement,
  input: { nowIso: string; boundGenerationId?: string },
): { snapshot: SessionContextSnapshot; drop: boolean } {
  if (measurement.sessionId !== snapshot.sessionId) {
    return { snapshot, drop: true };
  }
  if (
    measurement.runtimeGenerationId !== undefined &&
    input.boundGenerationId !== undefined &&
    measurement.runtimeGenerationId !== input.boundGenerationId
  ) {
    return { snapshot, drop: true };
  }
  if (snapshot.phase === 'empty' || snapshot.phase === 'invalidated') {
    return { snapshot, drop: true };
  }
  if (!boundaryCompatible(snapshot.contextBoundary, measurement.contextBoundary)) {
    return { snapshot, drop: true };
  }
  const contextBoundary: ContextBoundary = {
    ...snapshot.contextBoundary,
    ...measurement.contextBoundary,
  };
  let next = stampOwner({ ...snapshot, contextBoundary, updatedAt: input.nowIso }, measurement);
  if (isBlockedOccupancy(measurement.occupancy)) {
    next = {
      ...next,
      occupancy: { kind: 'unknown', reason: blockedReason(measurement.occupancy) },
    };
    if (snapshot.phase !== 'compacting' && snapshot.phase !== 'waiting-response') {
      next.phase = snapshot.responseEvidence.currentRunHasResponse ? 'streaming' : snapshot.phase;
    }
    return { snapshot: next, drop: false };
  }
  if (measurement.occupancy.kind !== 'known') {
    return { snapshot, drop: true };
  }
  next.lastConfirmed = {
    occupancy: measurement.occupancy,
    contextBoundary,
    sampledAt: measurement.occupancy.sampledAt,
  };
  if (snapshot.phase === 'waiting-response' && !snapshot.responseEvidence.currentRunHasResponse) {
    next.occupancy = { kind: 'unknown', reason: 'waiting-for-response' };
    return { snapshot: next, drop: false };
  }
  next.occupancy = measurement.occupancy;
  if (snapshot.phase !== 'compacting') {
    next.phase = snapshot.responseEvidence.currentRunHasResponse ? 'streaming' : snapshot.phase;
  }
  return { snapshot: next, drop: false };
}

export function applyResponseEvidence(
  snapshot: SessionContextSnapshot,
  input: { nowIso: string; runId?: string; messageId?: string },
): { snapshot: SessionContextSnapshot; immediate: boolean } {
  if (snapshot.responseEvidence.currentRunHasResponse) {
    return { snapshot, immediate: false };
  }
  // Promote against the pre-evidence leaf so lastConfirmed still matches,
  // then advance the leaf to the new assistant message. Contracts promotion
  // is idle-only; evidence-time lift uses an idle candidate without changing
  // the live waiting/invalidated/compact gates.
  const phase = snapshot.phase === 'compacting' ? 'compacting' : 'streaming';
  let next = stampOwner(
    {
      ...snapshot,
      contextBoundary: snapshot.contextBoundary,
      occupancy: snapshot.occupancy,
      phase,
      responseEvidence: {
        currentRunHasResponse: true,
        historyHasDisplayableResponse: true,
        ...(input.messageId !== undefined ? { evidenceMessageId: input.messageId } : {}),
      },
      updatedAt: input.nowIso,
    },
    input,
  );
  if (snapshot.phase === 'waiting-response' || snapshot.phase === 'idle') {
    const candidate: SessionContextSnapshot = { ...next, phase: 'idle' };
    next = { ...promoteLastConfirmed(candidate), phase };
  }
  if (input.messageId !== undefined) {
    next = {
      ...next,
      contextBoundary: {
        ...next.contextBoundary,
        activeLeafMessageId: input.messageId,
      },
      updatedAt: input.nowIso,
    };
  }
  return { snapshot: next, immediate: true };
}

export function applyRunStarted(
  snapshot: SessionContextSnapshot,
  input: { nowIso: string; runId: string; runtimeGenerationId?: string },
): SessionContextSnapshot {
  const lastConfirmed =
    snapshot.occupancy.kind === 'known'
      ? {
          occupancy: snapshot.occupancy,
          contextBoundary: snapshot.contextBoundary,
          sampledAt: snapshot.occupancy.sampledAt,
        }
      : snapshot.lastConfirmed;
  const next: SessionContextSnapshot = {
    ...snapshot,
    runId: input.runId,
    phase: 'waiting-response',
    occupancy: { kind: 'unknown', reason: 'waiting-for-response' },
    responseEvidence: {
      currentRunHasResponse: false,
      historyHasDisplayableResponse: snapshot.responseEvidence.historyHasDisplayableResponse,
    },
    updatedAt: input.nowIso,
  };
  if (input.runtimeGenerationId !== undefined) {
    next.runtimeGenerationId = input.runtimeGenerationId;
  }
  if (lastConfirmed !== undefined) {
    next.lastConfirmed = lastConfirmed;
  }
  return next;
}

export function applyRunTerminal(
  snapshot: SessionContextSnapshot,
  input: { nowIso: string; runId: string },
): SessionContextSnapshot {
  if (snapshot.runId !== input.runId) {
    return snapshot;
  }
  const next: SessionContextSnapshot = { ...snapshot, updatedAt: input.nowIso };
  delete next.runId;
  if (!snapshot.responseEvidence.currentRunHasResponse) {
    next.occupancy = { kind: 'unknown', reason: 'run-ended-without-response' };
    next.phase = snapshot.responseEvidence.historyHasDisplayableResponse ? 'idle' : 'empty';
    return promoteLastConfirmed(next);
  }
  next.phase = snapshot.phase === 'compacting' ? 'compacting' : 'idle';
  return promoteLastConfirmed(next);
}

export function applyCompactionStart(
  snapshot: SessionContextSnapshot,
  nowIso: string,
): SessionContextSnapshot {
  return { ...snapshot, phase: 'compacting', updatedAt: nowIso };
}

export function applyCompactionEnd(
  snapshot: SessionContextSnapshot,
  input: { nowIso: string; ok: boolean; tokensAfter?: number; tokensBefore?: number },
): SessionContextSnapshot {
  if (!input.ok) {
    return {
      ...snapshot,
      phase: snapshot.responseEvidence.currentRunHasResponse ? 'streaming' : 'idle',
      updatedAt: input.nowIso,
    };
  }
  const contextVersion = snapshot.contextVersion + 1;
  const compactionBoundary = formatCompactionBoundary(input);
  const contextBoundary: ContextBoundary = {
    ...snapshot.contextBoundary,
    compactionBoundary,
  };
  // A successful compaction is itself durable response evidence: the model
  // received a non-empty context and Pi produced a summary for it. Keep the
  // ring eligible even when the transcript contains only media/tool rows and
  // no displayable assistant text was observed by the UI.
  const responseEvidence = {
    ...snapshot.responseEvidence,
    historyHasDisplayableResponse: true,
  };
  if (
    typeof input.tokensAfter === 'number' &&
    Number.isFinite(input.tokensAfter) &&
    input.tokensAfter >= 0
  ) {
    const occupancy: Extract<ContextOccupancy, { kind: 'known' }> = {
      kind: 'known',
      tokensUsed: input.tokensAfter,
      quality: 'estimated',
      coverage: 'complete',
      basis: 'compaction',
      sampledAt: input.nowIso,
    };
    if (snapshot.occupancy.kind === 'known' && snapshot.occupancy.tokensLimit !== undefined) {
      occupancy.tokensLimit = snapshot.occupancy.tokensLimit;
    }
    return {
      ...snapshot,
      contextVersion,
      contextBoundary,
      responseEvidence,
      occupancy,
      lastConfirmed: { occupancy, contextBoundary, sampledAt: input.nowIso },
      phase: 'idle',
      updatedAt: input.nowIso,
    };
  }
  const unmeasured: SessionContextSnapshot = {
    ...snapshot,
    contextVersion,
    contextBoundary,
    responseEvidence,
    occupancy: { kind: 'unknown', reason: 'compaction-unmeasured' },
    phase: 'idle',
    updatedAt: input.nowIso,
  };
  delete unmeasured.lastConfirmed;
  return unmeasured;
}

export function applyInvalidate(
  snapshot: SessionContextSnapshot,
  input: { nowIso: string; reason: string; empty?: boolean; contextBoundary?: ContextBoundary },
): SessionContextSnapshot {
  const contextBoundary = input.contextBoundary ?? {
    ...snapshot.contextBoundary,
    activeLeafMessageId: input.empty === true ? null : snapshot.contextBoundary.activeLeafMessageId,
  };
  const next: SessionContextSnapshot = {
    ...snapshot,
    contextVersion: snapshot.contextVersion + 1,
    contextBoundary,
    occupancy: { kind: 'unknown', reason: input.reason },
    phase: input.empty === true ? 'empty' : 'invalidated',
    responseEvidence: {
      currentRunHasResponse: false,
      historyHasDisplayableResponse:
        input.empty === true ? false : snapshot.responseEvidence.historyHasDisplayableResponse,
    },
    updatedAt: input.nowIso,
  };
  delete next.runId;
  delete next.lastConfirmed;
  delete next.coveredMessageId;
  delete next.coveredRequestId;
  return next;
}

export function applyActivationRevalidate(
  snapshot: SessionContextSnapshot,
  input: { nowIso: string; runtimeGenerationId: string; contextBoundary: ContextBoundary },
): SessionContextSnapshot {
  // A durable compaction boundary can outlive the in-memory context snapshot
  // (for example when the Host crashed between the two writes). Its presence
  // is itself proof that the session has displayable history, so a cold
  // rebind must not hide the context ring while occupancy is re-measured.
  const historyHasDisplayableResponse =
    snapshot.responseEvidence.historyHasDisplayableResponse ||
    input.contextBoundary.compactionBoundary !== undefined;
  const next: SessionContextSnapshot = {
    ...snapshot,
    runtimeGenerationId: input.runtimeGenerationId,
    updatedAt: input.nowIso,
    responseEvidence: {
      ...snapshot.responseEvidence,
      historyHasDisplayableResponse,
    },
  };
  delete next.runId;
  if (activationBoundaryMatches(snapshot.contextBoundary, input.contextBoundary)) {
    next.contextBoundary = {
      ...snapshot.contextBoundary,
      ...input.contextBoundary,
    };
    return next;
  }
  next.contextVersion = snapshot.contextVersion + 1;
  next.contextBoundary = input.contextBoundary;
  next.occupancy = { kind: 'unknown', reason: 'runtime-generation-mismatch' };
  next.phase = 'invalidated';
  next.responseEvidence = {
    currentRunHasResponse: false,
    historyHasDisplayableResponse,
  };
  return next;
}
