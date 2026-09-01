import type { ModelRef } from './host.js';

export const CONTEXT_TELEMETRY_VERSION = 1 as const;
export type ContextTelemetryVersion = typeof CONTEXT_TELEMETRY_VERSION;

export type ContextOccupancyQuality = 'measured' | 'estimated';
export type ContextOccupancyCoverage = 'complete' | 'partial';
export type SessionContextPhase =
  | 'empty'
  | 'waiting-response'
  | 'streaming'
  | 'idle'
  | 'compacting'
  | 'invalidated'
  | 'unavailable';

export type ContextBoundary = {
  activeLeafMessageId: string | null;
  compactionBoundary?: string;
  model?: import('./host.js').ModelRef;
  capabilityFingerprint?: string;
  seedFingerprint?: string;
};

export type ContextOccupancy =
  | {
      kind: 'known';
      tokensUsed: number; // finite, >= 0
      tokensLimit?: number; // finite, > 0 when present
      quality: ContextOccupancyQuality;
      coverage: ContextOccupancyCoverage;
      basis: string;
      sampledAt: string; // display only; never used for ordering
    }
  | { kind: 'unknown'; reason: string };

export type ContextResponseEvidence = {
  currentRunHasResponse: boolean;
  historyHasDisplayableResponse: boolean;
  evidenceMessageId?: string;
};

export type SessionContextSnapshot = {
  sessionId: string;
  revision: number; // integer >= 1, per-session monotonic including hide/invalid
  contextVersion: number; // integer >= 1; bumps on compact success, branch, truncate, model/capability change, cold-activation rebuild
  contextBoundary: ContextBoundary;
  runId?: string; // required when a live owner exists
  runtimeGenerationId?: string;
  responseEvidence: ContextResponseEvidence;
  phase: SessionContextPhase;
  occupancy: ContextOccupancy;
  lastConfirmed?: {
    occupancy: Extract<ContextOccupancy, { kind: 'known' }>;
    contextBoundary: ContextBoundary;
    sampledAt: string;
  };
  updatedAt: string; // display only
  coveredMessageId?: string;
  coveredRequestId?: string;
};

export type ContextMeasurement = {
  sessionId: string;
  runId?: string;
  runtimeGenerationId?: string;
  messageId?: string;
  sampleSequence: number; // assigned at capture, not at send
  occupancy: ContextOccupancy;
  contextBoundary: ContextBoundary;
  sampledAt: string;
};

export function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parseSessionContextSnapshot(value: unknown): SessionContextSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isNonEmptyString(value.sessionId) ||
    !isPositiveInteger(value.revision) ||
    !isPositiveInteger(value.contextVersion)
  ) {
    return null;
  }
  if (!isNonEmptyString(value.updatedAt) || !isSessionContextPhase(value.phase)) {
    return null;
  }
  const contextBoundary = parseContextBoundary(value.contextBoundary);
  const occupancy = parseContextOccupancy(value.occupancy);
  const responseEvidence = parseResponseEvidence(value.responseEvidence);
  if (contextBoundary === null || occupancy === null || responseEvidence === null) {
    return null;
  }
  const snapshot: SessionContextSnapshot = {
    sessionId: value.sessionId,
    revision: value.revision,
    contextVersion: value.contextVersion,
    contextBoundary,
    responseEvidence,
    phase: value.phase,
    occupancy,
    updatedAt: value.updatedAt,
  };
  const runId = optionalNonEmptyString(value.runId);
  if (runId === false) return null;
  if (runId !== undefined) snapshot.runId = runId;
  const runtimeGenerationId = optionalNonEmptyString(value.runtimeGenerationId);
  if (runtimeGenerationId === false) return null;
  if (runtimeGenerationId !== undefined) snapshot.runtimeGenerationId = runtimeGenerationId;
  const coveredMessageId = optionalNonEmptyString(value.coveredMessageId);
  if (coveredMessageId === false) return null;
  if (coveredMessageId !== undefined) snapshot.coveredMessageId = coveredMessageId;
  const coveredRequestId = optionalNonEmptyString(value.coveredRequestId);
  if (coveredRequestId === false) return null;
  if (coveredRequestId !== undefined) snapshot.coveredRequestId = coveredRequestId;
  if (value.lastConfirmed !== undefined) {
    const lastConfirmed = parseLastConfirmed(value.lastConfirmed);
    if (lastConfirmed === null) return null;
    snapshot.lastConfirmed = lastConfirmed;
  }
  return snapshot;
}

function sameWhenSet(current: string | undefined, incoming: string | undefined): boolean {
  if (current === undefined || current.length === 0) {
    return true;
  }
  return (incoming ?? '') === current;
}

/** Stored `current` may take the first incoming leaf; a stamped leaf cannot jump. */
export function contextBoundaryCompatible(
  current: ContextBoundary,
  incoming: ContextBoundary,
): boolean {
  if (current.activeLeafMessageId !== incoming.activeLeafMessageId) {
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

const PROMOTABLE_UNKNOWN_REASONS = new Set([
  'waiting-for-response',
  'run-ended-without-response',
]);

/**
 * Same-boundary idle dirty occupancy may lift `lastConfirmed` as current authority.
 * Live waiting, invalidate, compact, abort, and generation mismatch must not.
 */
export function canPromoteLastConfirmed(snapshot: SessionContextSnapshot): boolean {
  if (snapshot.occupancy.kind !== 'unknown') {
    return false;
  }
  if (!PROMOTABLE_UNKNOWN_REASONS.has(snapshot.occupancy.reason)) {
    return false;
  }
  const lastConfirmed = snapshot.lastConfirmed;
  if (lastConfirmed === undefined || lastConfirmed.occupancy.kind !== 'known') {
    return false;
  }
  if (snapshot.phase !== 'idle') {
    return false;
  }
  if (
    !snapshot.responseEvidence.currentRunHasResponse &&
    !snapshot.responseEvidence.historyHasDisplayableResponse
  ) {
    return false;
  }
  return contextBoundaryCompatible(lastConfirmed.contextBoundary, snapshot.contextBoundary);
}

/** Current known occupancy only. lastConfirmed is not a display fallback here. */
export function ringOccupancyFromSnapshot(
  snapshot: SessionContextSnapshot,
): Extract<ContextOccupancy, { kind: 'known' }> | null {
  return snapshot.occupancy.kind === 'known' ? snapshot.occupancy : null;
}

/** Pure occupancy lift. Caller owns `updatedAt` and persist revision; phase stays as-is. */
export function promoteLastConfirmed(snapshot: SessionContextSnapshot): SessionContextSnapshot {
  if (!canPromoteLastConfirmed(snapshot)) {
    return snapshot;
  }
  const lastConfirmed = snapshot.lastConfirmed;
  if (lastConfirmed === undefined) {
    return snapshot;
  }
  return {
    ...snapshot,
    occupancy: lastConfirmed.occupancy,
    lastConfirmed,
  };
}

export function createUnknownSessionContextSnapshot(input: {
  sessionId: string;
  revision: number;
  contextVersion: number;
  contextBoundary: ContextBoundary;
  phase?: SessionContextPhase;
  reason: string;
  updatedAt: string;
}): SessionContextSnapshot {
  return {
    sessionId: input.sessionId,
    revision: input.revision,
    contextVersion: input.contextVersion,
    contextBoundary: input.contextBoundary,
    responseEvidence: {
      currentRunHasResponse: false,
      historyHasDisplayableResponse: false,
    },
    phase: input.phase ?? 'empty',
    occupancy: { kind: 'unknown', reason: input.reason },
    updatedAt: input.updatedAt,
  };
}

export function parseContextBoundary(value: unknown): ContextBoundary | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.activeLeafMessageId !== null && !isNonEmptyString(value.activeLeafMessageId)) {
    return null;
  }
  const boundary: ContextBoundary = { activeLeafMessageId: value.activeLeafMessageId };
  const compactionBoundary = optionalNonEmptyString(value.compactionBoundary);
  if (compactionBoundary === false) return null;
  if (compactionBoundary !== undefined) boundary.compactionBoundary = compactionBoundary;
  if (value.model !== undefined) {
    const model = parseModelRef(value.model);
    if (model === null) return null;
    boundary.model = model;
  }
  const capabilityFingerprint = optionalNonEmptyString(value.capabilityFingerprint);
  if (capabilityFingerprint === false) return null;
  if (capabilityFingerprint !== undefined) boundary.capabilityFingerprint = capabilityFingerprint;
  const seedFingerprint = optionalNonEmptyString(value.seedFingerprint);
  if (seedFingerprint === false) return null;
  if (seedFingerprint !== undefined) boundary.seedFingerprint = seedFingerprint;
  return boundary;
}

export function parseContextOccupancy(value: unknown): ContextOccupancy | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === 'unknown') {
    if (
      'tokensUsed' in value ||
      'tokensLimit' in value ||
      'quality' in value ||
      'coverage' in value ||
      'basis' in value ||
      'sampledAt' in value
    ) {
      return null;
    }
    if (!isNonEmptyString(value.reason)) {
      return null;
    }
    return { kind: 'unknown', reason: value.reason };
  }
  if (value.kind !== 'known') {
    return null;
  }
  if (
    !isFiniteNonNegative(value.tokensUsed) ||
    !isOccupancyQuality(value.quality) ||
    !isOccupancyCoverage(value.coverage) ||
    !isNonEmptyString(value.basis) ||
    !isNonEmptyString(value.sampledAt)
  ) {
    return null;
  }
  const occupancy: Extract<ContextOccupancy, { kind: 'known' }> = {
    kind: 'known',
    tokensUsed: value.tokensUsed,
    quality: value.quality,
    coverage: value.coverage,
    basis: value.basis,
    sampledAt: value.sampledAt,
  };
  if (value.tokensLimit !== undefined) {
    if (!isPositiveFinite(value.tokensLimit)) {
      return null;
    }
    occupancy.tokensLimit = value.tokensLimit;
  }
  return occupancy;
}

function parseLastConfirmed(
  value: unknown,
): {
  occupancy: Extract<ContextOccupancy, { kind: 'known' }>;
  contextBoundary: ContextBoundary;
  sampledAt: string;
} | null {
  if (!isRecord(value) || !isNonEmptyString(value.sampledAt)) {
    return null;
  }
  const occupancy = parseContextOccupancy(value.occupancy);
  const contextBoundary = parseContextBoundary(value.contextBoundary);
  if (occupancy === null || occupancy.kind !== 'known' || contextBoundary === null) {
    return null;
  }
  return { occupancy, contextBoundary, sampledAt: value.sampledAt };
}

function parseResponseEvidence(value: unknown): ContextResponseEvidence | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.currentRunHasResponse !== 'boolean' ||
    typeof value.historyHasDisplayableResponse !== 'boolean'
  ) {
    return null;
  }
  const evidence: ContextResponseEvidence = {
    currentRunHasResponse: value.currentRunHasResponse,
    historyHasDisplayableResponse: value.historyHasDisplayableResponse,
  };
  const evidenceMessageId = optionalNonEmptyString(value.evidenceMessageId);
  if (evidenceMessageId === false) return null;
  if (evidenceMessageId !== undefined) evidence.evidenceMessageId = evidenceMessageId;
  return evidence;
}

function parseModelRef(value: unknown): ModelRef | null {
  if (!isRecord(value) || !isNonEmptyString(value.providerId) || !isNonEmptyString(value.modelId)) {
    return null;
  }
  const model: ModelRef = { providerId: value.providerId, modelId: value.modelId };
  if (value.protocol !== undefined) {
    if (
      value.protocol !== 'openai-compatible' &&
      value.protocol !== 'anthropic-compatible' &&
      value.protocol !== 'google-gemini'
    ) {
      return null;
    }
    model.protocol = value.protocol;
  }
  if (value.source !== undefined) {
    if (value.source !== 'channel' && value.source !== 'subscription') {
      return null;
    }
    model.source = value.source;
  }
  return model;
}

function isSessionContextPhase(value: unknown): value is SessionContextPhase {
  return (
    value === 'empty' ||
    value === 'waiting-response' ||
    value === 'streaming' ||
    value === 'idle' ||
    value === 'compacting' ||
    value === 'invalidated' ||
    value === 'unavailable'
  );
}

function isOccupancyQuality(value: unknown): value is ContextOccupancyQuality {
  return value === 'measured' || value === 'estimated';
}

function isOccupancyCoverage(value: unknown): value is ContextOccupancyCoverage {
  return value === 'complete' || value === 'partial';
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalNonEmptyString(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  return isNonEmptyString(value) ? value : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
