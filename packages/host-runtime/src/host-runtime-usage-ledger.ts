/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { formatError } from '@piwin/contracts';

import { appendUsageRecord } from '@piwin/session';
import type { AssistantUsageMeasurement, ContextUsageSnapshot, UsageRecord } from '@piwin/contracts';
import { getPiwinRoot, getPiwinUsageLedgerPath } from './paths.js';
import { projectSnapshotToLegacyUsage } from './session-context-coordinator.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export async function recordFinalizedUsageToLedger(
  deps: HostRuntimeKernel,
  sessionId: string,
  measurement: AssistantUsageMeasurement,
): Promise<'inserted' | 'duplicate' | 'unavailable'> {
  if (measurement.sessionId !== sessionId || !Number.isFinite(measurement.totalTokens)) {
    return 'unavailable';
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const ledgerPath = getPiwinUsageLedgerPath(rootDir);
  const projectPath = deps.sessionProjects.get(sessionId) ?? '';
  const modelRef = deps.sessionModels.get(sessionId);
  const thinkingLevel = measurement.thinkingLevel ?? deps.sessionThinkingLevels?.get(sessionId);
  const modelId = measurement.modelId ?? modelRef?.modelId;
  const record: UsageRecord = {
    sessionId,
    projectPath: projectPath.trim().length > 0 ? projectPath : null,
    totalTokens: measurement.totalTokens,
    source: 'assistant-usage',
    recordedAt: measurement.recordedAt,
    measurementId: measurement.measurementId,
    messageId: measurement.messageId,
  };
  if (modelRef?.providerId) record.providerId = modelRef.providerId;
  if (modelId) record.modelId = modelId;
  if (thinkingLevel) record.thinkingLevel = thinkingLevel;
  if (measurement.runId !== undefined) record.runId = measurement.runId;
  if (measurement.promptTokens !== undefined) record.promptTokens = measurement.promptTokens;
  if (measurement.completionTokens !== undefined) {
    record.completionTokens = measurement.completionTokens;
  }
  if (measurement.cacheReadTokens !== undefined) record.cacheReadTokens = measurement.cacheReadTokens;
  if (measurement.cacheWriteTokens !== undefined) {
    record.cacheWriteTokens = measurement.cacheWriteTokens;
  }
  if (measurement.durationMs !== undefined) record.durationMs = measurement.durationMs;
  try {
    const result = await appendUsageRecord(ledgerPath, record);
    if (result === 'inserted') {
      const projected = projectFinalizedUsage(measurement);
      deps.sessionUsage.set(sessionId, projected);
    }
    return result;
  } catch (error) {
    const message = formatError(error);
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `usage ledger write failed: ${message}`,
    });
    return 'unavailable';
  }
}

export function projectFinalizedUsage(measurement: AssistantUsageMeasurement): ContextUsageSnapshot {
  const usage: ContextUsageSnapshot = {
    sessionId: measurement.sessionId,
    totalTokens: measurement.totalTokens,
    updatedAt: measurement.recordedAt,
    source: 'assistant-usage',
  };
  if (measurement.modelId !== undefined) usage.modelId = measurement.modelId;
  if (measurement.thinkingLevel !== undefined) usage.thinkingLevel = measurement.thinkingLevel;
  if (measurement.promptTokens !== undefined) usage.promptTokens = measurement.promptTokens;
  if (measurement.completionTokens !== undefined) usage.completionTokens = measurement.completionTokens;
  if (measurement.cacheReadTokens !== undefined) usage.cacheReadTokens = measurement.cacheReadTokens;
  if (measurement.cacheWriteTokens !== undefined) usage.cacheWriteTokens = measurement.cacheWriteTokens;
  if (measurement.durationMs !== undefined) usage.durationMs = measurement.durationMs;
  return usage;
}

export async function recordUsageToLedger(
  deps: HostRuntimeKernel,
  sessionId: string,
  usage: ContextUsageSnapshot,
): Promise<void> {
  const totalTokens = usage.totalTokens ?? usage.tokensUsed;
  if (totalTokens === undefined || !Number.isFinite(totalTokens)) {
    return;
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const ledgerPath = getPiwinUsageLedgerPath(rootDir);
  const projectPath = deps.sessionProjects.get(sessionId) ?? '';
  const modelRef = deps.sessionModels.get(sessionId);
  const thinkingLevel = usage.thinkingLevel ?? deps.sessionThinkingLevels?.get(sessionId);
  const modelId = usage.modelId ?? modelRef?.modelId;
  const record: UsageRecord = {
    sessionId,
    projectPath: projectPath.trim().length > 0 ? projectPath : null,
    ...(modelRef?.providerId ? { providerId: modelRef.providerId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(usage.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
    ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(usage.durationMs !== undefined ? { durationMs: usage.durationMs } : {}),
    totalTokens,
    source: usage.source === 'host-estimate' ? 'host-estimate' : 'assistant-usage',
    recordedAt: new Date().toISOString(),
  };
  try {
    await appendUsageRecord(ledgerPath, record);
  } catch (error) {
    const message = formatError(error);
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `usage ledger write failed: ${message}`,
    });
  }
}

export function enqueueUsageLedgerWrite(
  deps: HostRuntimeKernel,
  sessionId: string,
  usage: ContextUsageSnapshot,
): void {
  const write = deps.recordUsageToLedger(sessionId, usage);
  deps.pendingUsageLedgerWrites.add(write);
  void write.then(
    () => {
      deps.pendingUsageLedgerWrites.delete(write);
    },
    (error: unknown) => {
      deps.pendingUsageLedgerWrites.delete(write);
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `usage ledger write failed: ${formatError(error)}`,
      });
    },
  );
}

export async function flushUsageLedgerWrites(deps: HostRuntimeKernel): Promise<void> {
  while (deps.pendingUsageLedgerWrites.size > 0) {
    await Promise.allSettled([...deps.pendingUsageLedgerWrites]);
  }
}

export async function loadSessionUsage(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<ContextUsageSnapshot | null> {
  const snapshot = await deps.sessionContextCoordinator.getSnapshot(sessionId);
  const projected = projectSnapshotToLegacyUsage(snapshot);
  if (projected !== undefined) {
    deps.sessionUsage.set(sessionId, projected);
    return projected;
  }
  return deps.sessionUsage.get(sessionId) ?? null;
}

export async function maybeEmitUsageOnMessageEnd(
  _deps: HostRuntimeKernel,
  _sessionId: string,
  _messageId: string,
): Promise<void> {
  // Production occupancy/billing uses usage/finalized. Mock adapters emit
  // their own finalized measurements; this fallback must not invent bills.
}
