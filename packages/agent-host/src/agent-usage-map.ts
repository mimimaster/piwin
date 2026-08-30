import type { AgentEvent, AssistantUsageMeasurement } from '@piwin/contracts';
import type { OccupancyRequestUsage } from './context-occupancy-estimator.js';
import { assistantUsageMeasurementId } from './generation-identity.js';
import { mapUsageSnapshot } from './usage-map.js';
import { asRecord, readString } from './pi-event-read.js';

export function mapPiUsageEvent(event: Record<string, unknown>): AgentEvent[] {
  const sessionId = readString(event.sessionId) ?? 'unknown';
  const snapshot = mapUsageSnapshot(sessionId, event, 'pi-contextUsage');
  if (!snapshot) {
    return [];
  }
  return [{ type: 'usage/update', sessionId, usage: snapshot }];
}

export function mapAgentEndMessageUsageEvents(event: Record<string, unknown>): AgentEvent[] {
  const sessionId = readString(event.sessionId) ?? 'unknown';
  const assistantUsageEvents: AgentEvent[] = [];
  if (!Array.isArray(event.messages)) {
    return [];
  }
  for (const message of event.messages) {
    const assistantMessage = asRecord(message);
    if (assistantMessage?.role !== 'assistant') {
      continue;
    }
    const snapshot = mapUsageSnapshot(sessionId, assistantMessage, 'assistant-usage');
    if (snapshot) {
      assistantUsageEvents.push({ type: 'usage/update', sessionId, usage: snapshot });
    }
  }
  return assistantUsageEvents;
}

export function mapAgentEndFallbackUsageEvent(event: Record<string, unknown>): AgentEvent[] {
  const sessionId = readString(event.sessionId) ?? 'unknown';
  const snapshot =
    mapUsageSnapshot(sessionId, event, 'assistant-usage') ??
    mapUsageSnapshot(sessionId, asRecord(event.usage) ?? {}, 'assistant-usage');
  if (!snapshot) {
    return [];
  }
  return [{ type: 'usage/update', sessionId, usage: snapshot }];
}

export function mapFinalizedAssistantUsage(input: {
  sessionId: string;
  runtimeGenerationId: string;
  messageId: string;
  rawMessage: unknown;
  runId?: string;
  recordedAt: string;
}): AssistantUsageMeasurement | null {
  const snapshot = mapUsageSnapshot(input.sessionId, input.rawMessage, 'assistant-usage');
  if (!snapshot) {
    return null;
  }
  const record = asRecord(input.rawMessage);
  const stopReason = readString(record?.stopReason);
  const totalTokens =
    snapshot.totalTokens ??
    ((snapshot.promptTokens ?? 0) +
      (snapshot.completionTokens ?? 0) +
      (snapshot.cacheReadTokens ?? 0) +
      (snapshot.cacheWriteTokens ?? 0));
  const allZero =
    totalTokens === 0 &&
    (snapshot.promptTokens ?? 0) === 0 &&
    (snapshot.completionTokens ?? 0) === 0 &&
    (snapshot.cacheReadTokens ?? 0) === 0 &&
    (snapshot.cacheWriteTokens ?? 0) === 0;
  if (allZero && (stopReason === 'error' || stopReason === 'aborted')) {
    return null;
  }
  const measurement: AssistantUsageMeasurement = {
    measurementId: assistantUsageMeasurementId({
      sessionId: input.sessionId,
      runtimeGenerationId: input.runtimeGenerationId,
      messageId: input.messageId,
    }),
    sessionId: input.sessionId,
    messageId: input.messageId,
    totalTokens,
    recordedAt: input.recordedAt,
  };
  if (input.runId !== undefined) measurement.runId = input.runId;
  measurement.runtimeGenerationId = input.runtimeGenerationId;
  if (snapshot.modelId !== undefined) measurement.modelId = snapshot.modelId;
  if (snapshot.promptTokens !== undefined) measurement.promptTokens = snapshot.promptTokens;
  if (snapshot.completionTokens !== undefined) {
    measurement.completionTokens = snapshot.completionTokens;
  }
  if (snapshot.cacheReadTokens !== undefined) {
    measurement.cacheReadTokens = snapshot.cacheReadTokens;
  }
  if (snapshot.cacheWriteTokens !== undefined) {
    measurement.cacheWriteTokens = snapshot.cacheWriteTokens;
  }
  if (snapshot.durationMs !== undefined) measurement.durationMs = snapshot.durationMs;
  if (stopReason !== undefined && stopReason.length > 0) measurement.stopReason = stopReason;
  return measurement;
}

export function occupancyUsageFromRawMessage(
  rawMessage: unknown,
): OccupancyRequestUsage | undefined {
  const record = asRecord(rawMessage);
  if (!record) {
    return undefined;
  }
  const nested = asRecord(record.usage) ?? asRecord(record.tokenUsage) ?? record;
  const inputTokens =
    readFinite(nested.input) ?? readFinite(nested.inputTokens) ?? readFinite(nested.promptTokens);
  const outputTokens =
    readFinite(nested.output) ??
    readFinite(nested.outputTokens) ??
    readFinite(nested.completionTokens);
  const cacheReadTokens =
    readFinite(nested.cacheRead) ??
    readFinite(nested.cacheReadTokens) ??
    readFinite(nested.cache_read);
  const cacheWriteTokens =
    readFinite(nested.cacheWrite) ??
    readFinite(nested.cacheWriteTokens) ??
    readFinite(nested.cache_write);
  const totalTokens = readFinite(nested.totalTokens) ?? readFinite(nested.total);
  const stopReason = readString(record.stopReason);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheWriteTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  const usage: OccupancyRequestUsage = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (stopReason !== undefined && stopReason.length > 0) usage.stopReason = stopReason;
  return usage;
}

function readFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
