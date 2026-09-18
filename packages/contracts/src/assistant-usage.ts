import { isThinkingLevel, type ThinkingLevel } from './host.js';

export type AssistantUsageMeasurement = {
  measurementId: string; // stable; suggested key sessionId + runtimeGenerationId + messageId
  sessionId: string;
  runId?: string;
  runtimeGenerationId?: string;
  messageId: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  durationMs?: number;
  stopReason?: string;
  recordedAt: string;
};

export function parseAssistantUsageMeasurement(value: unknown): AssistantUsageMeasurement | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isNonEmptyString(value.measurementId) ||
    !isNonEmptyString(value.sessionId) ||
    !isNonEmptyString(value.messageId) ||
    !isNonEmptyString(value.recordedAt) ||
    !isFiniteNonNegativeNumber(value.totalTokens)
  ) {
    return null;
  }
  const measurement: AssistantUsageMeasurement = {
    measurementId: value.measurementId,
    sessionId: value.sessionId,
    messageId: value.messageId,
    totalTokens: value.totalTokens,
    recordedAt: value.recordedAt,
  };
  const runId = optionalNonEmptyString(value.runId);
  if (runId === false) return null;
  if (runId !== undefined) measurement.runId = runId;
  const runtimeGenerationId = optionalNonEmptyString(value.runtimeGenerationId);
  if (runtimeGenerationId === false) return null;
  if (runtimeGenerationId !== undefined) measurement.runtimeGenerationId = runtimeGenerationId;
  const modelId = optionalNonEmptyString(value.modelId);
  if (modelId === false) return null;
  if (modelId !== undefined) measurement.modelId = modelId;
  if (value.thinkingLevel !== undefined) {
    if (!isThinkingLevel(value.thinkingLevel)) return null;
    measurement.thinkingLevel = value.thinkingLevel;
  }
  const stopReason = optionalNonEmptyString(value.stopReason);
  if (stopReason === false) return null;
  if (stopReason !== undefined) measurement.stopReason = stopReason;
  if (!copyOptionalFiniteNonNegative(value, measurement, 'promptTokens')) return null;
  if (!copyOptionalFiniteNonNegative(value, measurement, 'completionTokens')) return null;
  if (!copyOptionalFiniteNonNegative(value, measurement, 'cacheReadTokens')) return null;
  if (!copyOptionalFiniteNonNegative(value, measurement, 'cacheWriteTokens')) return null;
  if (!copyOptionalFiniteNonNegative(value, measurement, 'durationMs')) return null;
  return measurement;
}

function copyOptionalFiniteNonNegative(
  source: Record<string, unknown>,
  target: AssistantUsageMeasurement,
  key: 'promptTokens' | 'completionTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'durationMs',
): boolean {
  const value = source[key];
  if (value === undefined) {
    return true;
  }
  if (!isFiniteNonNegativeNumber(value)) {
    return false;
  }
  target[key] = value;
  return true;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
