import type {
  ContextBoundary,
  ContextMeasurement,
  ContextOccupancy,
  SessionContextSnapshot,
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
      left.basis === right.basis
    );
  }
  return false;
}

export function snapshotDisplayEqual(
  left: SessionContextSnapshot,
  right: SessionContextSnapshot,
): boolean {
  return (
    left.phase === right.phase &&
    left.contextVersion === right.contextVersion &&
    occupancyEqual(left.occupancy, right.occupancy) &&
    left.responseEvidence.currentRunHasResponse === right.responseEvidence.currentRunHasResponse &&
    left.responseEvidence.historyHasDisplayableResponse ===
      right.responseEvidence.historyHasDisplayableResponse &&
    left.runId === right.runId &&
    left.runtimeGenerationId === right.runtimeGenerationId
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

function sameWhenSet(current: string | undefined, incoming: string | undefined): boolean {
  if (current === undefined || current.length === 0) {
    return true;
  }
  return (incoming ?? '') === current;
}

export function boundaryCompatible(current: ContextBoundary, incoming: ContextBoundary): boolean {
  if (current.activeLeafMessageId !== incoming.activeLeafMessageId) {
    // Unbound snapshots may take the first sample leaf; barriers stamp a leaf.
    if (current.activeLeafMessageId !== null) {
      return false;
    }
  }
  if (!sameWhenSet(current.compactionBoundary, incoming.compactionBoundary)) {
    return false;
  }
  if (!sameWhenSet(current.capabilityFingerprint, incoming.capabilityFingerprint)) {
    return false;
  }
  if (!sameWhenSet(current.seedFingerprint, incoming.seedFingerprint)) {
    return false;
  }
  if (current.model !== undefined && incoming.model !== undefined) {
    return (
      current.model.providerId === incoming.model.providerId &&
      current.model.modelId === incoming.model.modelId
    );
  }
  return true;
}

export function activationBoundaryMatches(
  current: ContextBoundary,
  incoming: ContextBoundary,
): boolean {
  return (
    boundaryCompatible(current, incoming) && current.activeLeafMessageId === incoming.activeLeafMessageId
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
  let next = stampOwner(
    { ...snapshot, contextBoundary, updatedAt: input.nowIso },
    measurement,
  );
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
  const nextBoundary: ContextBoundary = { ...snapshot.contextBoundary };
  if (input.messageId !== undefined) {
    nextBoundary.activeLeafMessageId = input.messageId;
  }
  const next = stampOwner(
    {
      ...snapshot,
      contextBoundary: nextBoundary,
      occupancy: snapshot.occupancy,
      phase: snapshot.phase === 'compacting' ? 'compacting' : 'streaming',
      responseEvidence: {
        currentRunHasResponse: true,
        historyHasDisplayableResponse: true,
        ...(input.messageId !== undefined ? { evidenceMessageId: input.messageId } : {}),
      },
      updatedAt: input.nowIso,
    },
    input,
  );
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
    return next;
  }
  next.phase = snapshot.phase === 'compacting' ? 'compacting' : 'idle';
  return next;
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
  const compactionBoundary = `compact:${input.tokensBefore ?? 'na'}:${input.tokensAfter ?? 'unknown'}`;
  const contextBoundary: ContextBoundary = {
    ...snapshot.contextBoundary,
    compactionBoundary,
  };
  if (typeof input.tokensAfter === 'number' && Number.isFinite(input.tokensAfter) && input.tokensAfter >= 0) {
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
  const next: SessionContextSnapshot = {
    ...snapshot,
    runtimeGenerationId: input.runtimeGenerationId,
    updatedAt: input.nowIso,
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
    historyHasDisplayableResponse: snapshot.responseEvidence.historyHasDisplayableResponse,
  };
  return next;
}
