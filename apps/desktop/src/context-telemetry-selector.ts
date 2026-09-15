import {
  contextBoundaryCompatible,
  promoteLastConfirmed,
  type AssistantUsageMeasurement,
  type ContextBoundary,
  type ContextOccupancy,
  type SessionContextPhase,
  type SessionContextSnapshot,
} from '@piwin/contracts';
import type { ContextTelemetryState } from './context-telemetry-reducer.js';
import {
  formatUsageTokenCount,
  getContextUsageCopy,
  type ContextUsageCopy,
  type ConversationUsageLocale,
} from './conversation-usage-copy.js';

type KnownOccupancy = Extract<ContextOccupancy, { kind: 'known' }>;

export type ContextRingLabels = {
  title: string;
  close: string;
  settings: string;
  status: string;
  quality: string;
  limitNote: string;
  exceeds: string;
  hover: string;
  accessibleLabel: string;
  percentFull: string;
  capabilityMissing: string;
  lastRequest: string;
};

export type ContextRingLastRequest = {
  messageId: string;
  promptTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
};

export type ContextRingViewModel = {
  visible: boolean;
  numericHidden: boolean;
  tokensUsed?: number;
  tokensLimit?: number;
  quality?: 'measured' | 'estimated';
  occupancySource: 'current' | 'last-confirmed';
  phase: SessionContextPhase | 'offline' | 'capability-missing' | 'compacted-pending';
  labels: ContextRingLabels;
  arcRatio: number;
  percentText?: number;
  exceedsLimit: boolean;
  limitUnknown: boolean;
  estimatedAgainstSelectedModel: boolean;
  compacting: boolean;
  offline: boolean;
  capabilityMissing: boolean;
  lastRequest?: ContextRingLastRequest;
  /** Occupancy sample time; ring derives a 5-min cache-expiry estimate from it. */
  cacheAnchorAt?: string;
  /** Locale the labels were built in; detail rows follow it. */
  locale: ConversationUsageLocale;
};

export type SelectContextRingViewInput = {
  telemetry: ContextTelemetryState;
  locale: ConversationUsageLocale;
  selectedModelContextWindow?: number;
  selectedModel?: { providerId: string; modelId: string };
  mountedMessageIds?: readonly string[];
  queuedTurnPending?: boolean;
  compactPendingOccupancy?: boolean;
  /** Client compaction in flight; label compacting, keep a known sample. */
  compacting?: boolean;
};

/** Compact-success unknown occupancy from chat UI state — not an in-flight compact. */
export function isChatCompactPendingOccupancy(state: {
  lastCompactionMessage: string | null;
  contextTelemetry: Pick<ContextTelemetryState, 'displayed'>;
}): boolean {
  const snapshot = state.contextTelemetry.displayed;
  if (snapshot?.occupancy.kind !== 'unknown') {
    return false;
  }
  if (state.lastCompactionMessage !== null) {
    return true;
  }
  // `lastCompactionMessage` is intentionally transient UI state. After a
  // restart, the Host can still expose the durable boundary and the
  // post-compaction measurement gap, so keep the ring visible as an
  // ellipsis/status affordance instead of making it disappear.
  return (
    (snapshot.occupancy.reason === 'compaction-unmeasured' ||
      snapshot.occupancy.reason === 'runtime-generation-mismatch') &&
    snapshot.contextBoundary.compactionBoundary !== undefined &&
    snapshot.responseEvidence.historyHasDisplayableResponse
  );
}

export function selectContextRingView(input: SelectContextRingViewInput): ContextRingViewModel {
  const copy = getContextUsageCopy(input.locale);
  const telemetry = input.telemetry;
  // Eligibility is Host evidence, not currently mounted transcript rows or queued turns.
  void input.mountedMessageIds;
  void input.queuedTurnPending;
  const capabilityMissing = telemetry.capabilitySupported !== true;
  const snapshot = telemetry.displayed ? promoteLastConfirmed(telemetry.displayed) : null;
  const lastRequest = projectLastRequest(telemetry.lastRequestUsage);

  if (capabilityMissing) {
    return hiddenView({
      copy,
      locale: input.locale,
      phase: 'capability-missing',
      capabilityMissing: true,
      lastRequest,
    });
  }

  if (telemetry.selectedSessionId === null || snapshot === null) {
    return hiddenView({ copy, locale: input.locale, phase: 'empty', lastRequest });
  }

  const compactPending = input.compactPendingOccupancy === true;
  const resolved = resolveRingOccupancy(snapshot);
  const known = resolved.occupancy;
  const occupancySource = resolved.occupancySource;
  // A derived transcript has valid historical response evidence, but its
  // runtime has not sampled the new active path yet. Keep the affordance
  // visible without presenting a copied or guessed number.
  const derivedPendingMeasurement = isDerivedPendingMeasurement(snapshot);
  const displayLimit = resolveDisplayLimit({
    snapshotLimit: known?.tokensLimit,
    selectedModelContextWindow: input.selectedModelContextWindow,
  });
  const estimatedAgainstSelectedModel = isEstimatedAgainstSelectedModel({
    known,
    selectedModelContextWindow: input.selectedModelContextWindow,
    selectedModel: input.selectedModel,
    snapshotModel: snapshot.contextBoundary.model,
  });

  const waitingWithoutResponse =
    snapshot.phase === 'waiting-response' && !snapshot.responseEvidence.currentRunHasResponse;
  const emptyPhase = snapshot.phase === 'empty' && known === null;
  const hasEvidence =
    snapshot.responseEvidence.currentRunHasResponse ||
    (snapshot.responseEvidence.historyHasDisplayableResponse &&
      snapshot.phase !== 'waiting-response') ||
    (known !== null && snapshot.phase === 'invalidated');
  const offline = telemetry.disconnected === true;
  const compacting = snapshot.phase === 'compacting' || input.compacting === true;

  if (emptyPhase || waitingWithoutResponse) {
    return hiddenView({ copy, locale: input.locale, phase: snapshot.phase, lastRequest, offline });
  }
  if (snapshot.phase === 'invalidated' && known === null && !compactPending) {
    return hiddenView({ copy, locale: input.locale, phase: snapshot.phase, lastRequest, offline });
  }

  if (!hasEvidence && !offline && !compactPending && !compacting) {
    return hiddenView({ copy, locale: input.locale, phase: snapshot.phase, lastRequest, offline });
  }

  if (!known && !compactPending && !offline && !compacting && !derivedPendingMeasurement) {
    return hiddenView({ copy, locale: input.locale, phase: snapshot.phase, lastRequest });
  }

  const tokensUsed = known?.tokensUsed;
  const percentText =
    typeof tokensUsed === 'number' && displayLimit !== undefined && displayLimit > 0
      ? Math.round((tokensUsed / displayLimit) * 100)
      : undefined;
  const exceedsLimit = percentText !== undefined && percentText > 100;
  const arcRatio =
    typeof tokensUsed === 'number' && displayLimit !== undefined && displayLimit > 0
      ? Math.min(1, Math.max(0, tokensUsed / displayLimit))
      : 0;
  const quality = known?.quality;
  const numericHidden = known === null;
  const phase: ContextRingViewModel['phase'] = compactPending
    ? 'compacted-pending'
    : compacting
      ? 'compacting'
      : offline
        ? 'offline'
        : snapshot.phase;
  const staleCopy = occupancySource === 'last-confirmed';
  const status = compactPending
    ? copy.compactedPending
    : compacting
      ? copy.compacting
      : offline
        ? copy.offline
        : derivedPendingMeasurement
          ? copy.pendingMeasurement
          : staleCopy
            ? copy.lastConfirmedPending
            : quality === 'estimated'
              ? snapshot.phase === 'streaming' || snapshot.phase === 'waiting-response'
                ? copy.realtimeEstimate
                : copy.estimated
              : quality === 'measured'
                ? copy.confirmed
                : copy.estimated;
  const limitNote = estimatedAgainstSelectedModel
    ? copy.estimatedAgainstSelectedModel
    : displayLimit === undefined
      ? copy.limitUnknown
      : '';
  const usedLabel = typeof tokensUsed === 'number' ? formatUsageTokenCount(tokensUsed) : '—';
  const limitLabel =
    displayLimit !== undefined ? formatUsageTokenCount(displayLimit) : copy.limitUnknown;
  const percentLabel = percentText !== undefined ? `${percentText}%` : undefined;

  return {
    visible: true,
    locale: input.locale,
    numericHidden,
    ...(typeof tokensUsed === 'number' ? { tokensUsed } : {}),
    ...(displayLimit !== undefined ? { tokensLimit: displayLimit } : {}),
    ...(quality !== undefined ? { quality } : {}),
    occupancySource,
    phase,
    labels: {
      title: copy.title,
      close: copy.close,
      settings: copy.settings,
      status,
      quality: staleCopy
        ? copy.lastConfirmedPending
        : derivedPendingMeasurement
          ? copy.pendingMeasurement
          : quality === 'measured'
            ? copy.confirmed
            : copy.estimated,
      limitNote,
      exceeds: exceedsLimit ? copy.exceedsLimit : '',
      hover: derivedPendingMeasurement
        ? copy.pendingMeasurement
        : copy.hover(usedLabel, limitLabel, percentLabel),
      accessibleLabel: derivedPendingMeasurement
        ? copy.pendingMeasurement
        : copy.accessibleLabel(usedLabel, limitLabel, percentLabel),
      percentFull: derivedPendingMeasurement
        ? copy.pendingMeasurement
        : percentText === undefined
          ? copy.limitUnknown
          : copy.percentFull(percentText),
      capabilityMissing: copy.capabilityMissing,
      lastRequest: copy.lastRequest,
    },
    arcRatio,
    ...(percentText !== undefined ? { percentText } : {}),
    exceedsLimit,
    limitUnknown: displayLimit === undefined,
    estimatedAgainstSelectedModel,
    compacting,
    offline,
    capabilityMissing: false,
    ...(lastRequest !== undefined ? { lastRequest } : {}),
    cacheAnchorAt: resolveCacheAnchorAt(snapshot, known, occupancySource),
  };
}

function isDerivedPendingMeasurement(snapshot: SessionContextSnapshot): boolean {
  return (
    snapshot.phase === 'idle' &&
    snapshot.occupancy.kind === 'unknown' &&
    snapshot.occupancy.reason === 'derived-session' &&
    snapshot.responseEvidence.historyHasDisplayableResponse
  );
}

function hiddenView(input: {
  copy: ContextUsageCopy;
  locale: ConversationUsageLocale;
  phase: ContextRingViewModel['phase'];
  capabilityMissing?: boolean | undefined;
  lastRequest?: ContextRingLastRequest | undefined;
  offline?: boolean | undefined;
}): ContextRingViewModel {
  return {
    visible: false,
    locale: input.locale,
    numericHidden: true,
    occupancySource: 'current',
    phase: input.phase,
    labels: {
      title: input.copy.title,
      close: input.copy.close,
      settings: input.copy.settings,
      status: input.capabilityMissing
        ? input.copy.capabilityMissing
        : input.offline
          ? input.copy.offline
          : '',
      quality: '',
      limitNote: '',
      exceeds: '',
      hover: '',
      accessibleLabel: input.copy.title,
      percentFull: '',
      capabilityMissing: input.copy.capabilityMissing,
      lastRequest: input.copy.lastRequest,
    },
    arcRatio: 0,
    exceedsLimit: false,
    limitUnknown: true,
    estimatedAgainstSelectedModel: false,
    compacting: false,
    offline: input.offline === true,
    capabilityMissing: input.capabilityMissing === true,
    ...(input.lastRequest !== undefined ? { lastRequest: input.lastRequest } : {}),
  };
}

function resolveRingOccupancy(snapshot: SessionContextSnapshot): {
  occupancy: KnownOccupancy | null;
  occupancySource: 'current' | 'last-confirmed';
} {
  const current =
    snapshot.phase === 'invalidated' || snapshot.occupancy.kind !== 'known'
      ? null
      : snapshot.occupancy;
  if (current) {
    return { occupancy: current, occupancySource: 'current' };
  }
  const stale = presentationLastConfirmedOccupancy(snapshot);
  if (stale) {
    return { occupancy: stale, occupancySource: 'last-confirmed' };
  }
  return { occupancy: null, occupancySource: 'current' };
}

function presentationLastConfirmedOccupancy(
  snapshot: SessionContextSnapshot,
): KnownOccupancy | null {
  // Legacy Hosts can return either `idle + runtime-generation-mismatch` or
  // `idle + waiting-for-response` after a response was interrupted while the
  // active leaf moved. Both are safe to present only through this stale,
  // read-only path; never promote them to current occupancy or feed them into
  // prompt budgeting. A live `waiting-response` phase remains hidden above.
  if (snapshot.phase !== 'invalidated' && snapshot.phase !== 'idle') {
    return null;
  }
  if (snapshot.occupancy.kind !== 'unknown') {
    return null;
  }
  if (
    snapshot.occupancy.reason !== 'runtime-generation-mismatch' &&
    snapshot.occupancy.reason !== 'waiting-for-response'
  ) {
    return null;
  }
  if (snapshot.occupancy.reason === 'waiting-for-response' && snapshot.phase !== 'idle') {
    return null;
  }
  if (snapshot.runId !== undefined || snapshot.responseEvidence.currentRunHasResponse) {
    return null;
  }
  if (!snapshot.responseEvidence.historyHasDisplayableResponse) {
    return null;
  }
  const lastConfirmed = snapshot.lastConfirmed;
  if (lastConfirmed === undefined || lastConfirmed.occupancy.kind !== 'known') {
    return null;
  }
  if (!nonLeafContextBoundaryCompatible(lastConfirmed.contextBoundary, snapshot.contextBoundary)) {
    return null;
  }
  return lastConfirmed.occupancy;
}

/** Same as contracts boundary compatibility, except a moved active leaf is allowed. */
function nonLeafContextBoundaryCompatible(
  lastConfirmedBoundary: ContextBoundary,
  currentBoundary: ContextBoundary,
): boolean {
  // A model switch invalidates the numeric sample for budgeting, but the
  // last-confirmed value is still useful as an explicitly stale, read-only
  // ring while the new model is measured. Compare every other boundary axis
  // and let the caller label the result as pending measurement.
  const lastWithoutModel = withoutModel(lastConfirmedBoundary);
  const currentWithoutModel = withoutModel(currentBoundary);
  return contextBoundaryCompatible(
    { ...lastWithoutModel, activeLeafMessageId: currentBoundary.activeLeafMessageId },
    currentWithoutModel,
  );
}

function withoutModel(boundary: ContextBoundary): ContextBoundary {
  const result = { ...boundary };
  delete result.model;
  return result;
}

function resolveDisplayLimit(input: {
  snapshotLimit?: number | undefined;
  selectedModelContextWindow?: number | undefined;
}): number | undefined {
  if (
    typeof input.selectedModelContextWindow === 'number' &&
    input.selectedModelContextWindow > 0
  ) {
    return input.selectedModelContextWindow;
  }
  if (typeof input.snapshotLimit === 'number' && input.snapshotLimit > 0) {
    return input.snapshotLimit;
  }
  return undefined;
}

function isEstimatedAgainstSelectedModel(input: {
  known: { tokensLimit?: number | undefined } | null;
  selectedModelContextWindow?: number | undefined;
  selectedModel?: { providerId: string; modelId: string } | undefined;
  snapshotModel?: { providerId: string; modelId: string } | undefined;
}): boolean {
  if (
    typeof input.selectedModelContextWindow !== 'number' ||
    input.selectedModelContextWindow <= 0
  ) {
    return false;
  }
  if (
    input.selectedModel &&
    input.snapshotModel &&
    (input.selectedModel.providerId !== input.snapshotModel.providerId ||
      input.selectedModel.modelId !== input.snapshotModel.modelId)
  ) {
    return true;
  }
  return (
    typeof input.known?.tokensLimit === 'number' &&
    input.known.tokensLimit !== input.selectedModelContextWindow
  );
}

function resolveCacheAnchorAt(
  snapshot: SessionContextSnapshot,
  occupancy: KnownOccupancy | null,
  occupancySource: 'current' | 'last-confirmed',
): string {
  if (occupancySource === 'last-confirmed' && snapshot.lastConfirmed) {
    return snapshot.lastConfirmed.sampledAt;
  }
  if (occupancy) {
    return occupancy.sampledAt;
  }
  return snapshot.updatedAt;
}

function projectLastRequest(
  usage: AssistantUsageMeasurement | null,
): ContextRingLastRequest | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    messageId: usage.messageId,
    ...(typeof usage.promptTokens === 'number' ? { promptTokens: usage.promptTokens } : {}),
    ...(typeof usage.cacheReadTokens === 'number'
      ? { cacheReadTokens: usage.cacheReadTokens }
      : {}),
    ...(typeof usage.cacheWriteTokens === 'number'
      ? { cacheWriteTokens: usage.cacheWriteTokens }
      : {}),
    ...(typeof usage.completionTokens === 'number'
      ? { completionTokens: usage.completionTokens }
      : {}),
    ...(typeof usage.totalTokens === 'number' ? { totalTokens: usage.totalTokens } : {}),
    ...(typeof usage.durationMs === 'number' ? { durationMs: usage.durationMs } : {}),
  };
}
