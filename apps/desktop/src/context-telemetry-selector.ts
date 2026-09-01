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
  return (
    state.contextTelemetry.displayed?.occupancy.kind === 'unknown' &&
    state.lastCompactionMessage !== null
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
      phase: 'capability-missing',
      capabilityMissing: true,
      lastRequest,
    });
  }

  if (telemetry.selectedSessionId === null || snapshot === null) {
    return hiddenView({ copy, phase: 'empty', lastRequest });
  }

  const compactPending = input.compactPendingOccupancy === true;
  const resolved = resolveRingOccupancy(snapshot);
  const known = resolved.occupancy;
  const occupancySource = resolved.occupancySource;
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
    return hiddenView({ copy, phase: snapshot.phase, lastRequest, offline });
  }
  if (snapshot.phase === 'invalidated' && known === null) {
    return hiddenView({ copy, phase: snapshot.phase, lastRequest, offline });
  }

  if (!hasEvidence && !offline && !compactPending && !compacting) {
    return hiddenView({ copy, phase: snapshot.phase, lastRequest, offline });
  }

  if (!known && !compactPending && !offline && !compacting) {
    return hiddenView({ copy, phase: snapshot.phase, lastRequest });
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
  const usedLabel =
    typeof tokensUsed === 'number' ? formatUsageTokenCount(tokensUsed) : '—';
  const limitLabel =
    displayLimit !== undefined ? formatUsageTokenCount(displayLimit) : copy.limitUnknown;
  const percentLabel = percentText !== undefined ? `${percentText}%` : undefined;

  return {
    visible: true,
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
        : quality === 'measured'
          ? copy.confirmed
          : copy.estimated,
      limitNote,
      exceeds: exceedsLimit ? copy.exceedsLimit : '',
      hover: copy.hover(usedLabel, limitLabel, percentLabel),
      accessibleLabel: copy.accessibleLabel(usedLabel, limitLabel, percentLabel),
      percentFull:
        percentText === undefined ? copy.limitUnknown : copy.percentFull(percentText),
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
  };
}

function hiddenView(input: {
  copy: ContextUsageCopy;
  phase: ContextRingViewModel['phase'];
  capabilityMissing?: boolean | undefined;
  lastRequest?: ContextRingLastRequest | undefined;
  offline?: boolean | undefined;
}): ContextRingViewModel {
  return {
    visible: false,
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
  if (snapshot.phase !== 'invalidated') {
    return null;
  }
  if (snapshot.occupancy.kind !== 'unknown') {
    return null;
  }
  if (snapshot.occupancy.reason !== 'runtime-generation-mismatch') {
    return null;
  }
  if (!snapshot.responseEvidence.historyHasDisplayableResponse) {
    return null;
  }
  const lastConfirmed = snapshot.lastConfirmed;
  if (lastConfirmed === undefined || lastConfirmed.occupancy.kind !== 'known') {
    return null;
  }
  if (
    !nonLeafContextBoundaryCompatible(
      lastConfirmed.contextBoundary,
      snapshot.contextBoundary,
    )
  ) {
    return null;
  }
  return lastConfirmed.occupancy;
}

/** Same as contracts boundary compatibility, except a moved active leaf is allowed. */
function nonLeafContextBoundaryCompatible(
  lastConfirmedBoundary: ContextBoundary,
  currentBoundary: ContextBoundary,
): boolean {
  return contextBoundaryCompatible(
    { ...lastConfirmedBoundary, activeLeafMessageId: currentBoundary.activeLeafMessageId },
    currentBoundary,
  );
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
