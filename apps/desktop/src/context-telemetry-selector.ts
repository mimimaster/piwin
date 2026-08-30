import type { AssistantUsageMeasurement, SessionContextPhase } from '@piwin/contracts';
import type { ContextTelemetryState } from './context-telemetry-reducer.js';
import {
  formatUsageTokenCount,
  getContextUsageCopy,
  type ContextUsageCopy,
  type ConversationUsageLocale,
} from './conversation-usage-copy.js';

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
};

export function selectContextRingView(input: SelectContextRingViewInput): ContextRingViewModel {
  const copy = getContextUsageCopy(input.locale);
  const telemetry = input.telemetry;
  // Eligibility is Host evidence, not currently mounted transcript rows or queued turns.
  void input.mountedMessageIds;
  void input.queuedTurnPending;
  const capabilityMissing = telemetry.capabilitySupported !== true;
  const snapshot = telemetry.displayed;
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

  const compactPending =
    input.compactPendingOccupancy === true || isCompactPendingReason(snapshot.occupancy);
  const occupancy = snapshot.occupancy;
  const known = occupancy.kind === 'known' ? occupancy : null;
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
  const emptyPhase = snapshot.phase === 'empty';
  const hasEvidence =
    snapshot.responseEvidence.currentRunHasResponse ||
    (snapshot.responseEvidence.historyHasDisplayableResponse &&
      snapshot.phase !== 'waiting-response');
  const offline = telemetry.disconnected === true;
  const compacting = snapshot.phase === 'compacting';

  if (emptyPhase || waitingWithoutResponse) {
    return hiddenView({ copy, phase: snapshot.phase, lastRequest, offline });
  }

  if (!hasEvidence && !offline && !compactPending && !compacting) {
    return hiddenView({ copy, phase: snapshot.phase, lastRequest, offline });
  }

  if (!known && !compactPending && !offline) {
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
    : offline
      ? 'offline'
      : snapshot.phase;
  const status = compactPending
    ? copy.compactedPending
    : compacting
      ? copy.compacting
      : offline
        ? copy.offline
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
    phase,
    labels: {
      title: copy.title,
      close: copy.close,
      settings: copy.settings,
      status,
      quality: quality === 'measured' ? copy.confirmed : copy.estimated,
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

function isCompactPendingReason(occupancy: {
  kind: string;
  reason?: string;
}): boolean {
  return occupancy.kind === 'unknown' && (occupancy.reason ?? '').includes('compact');
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
