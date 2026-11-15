import {
  formatError,
  normalizeUsageTokenSplit,
  parseAssistantUsageMeasurement,
  type AssistantUsageMeasurement,
  type SessionUsageTotals,
  type UsageRecord,
} from '@piwin/contracts';
import {
  getSessionRecord,
  listAllSessionRecords,
  summarizeMeasurementsIntoSessionTotals,
} from '@piwin/session';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { createSessionMeasurementCostEstimator } from './usage-reference-pricing.js';

/** Vendor logs are read by adapters; Host only validates normalized request accounting. */
export async function readBackendRequestUsage(deps: HostRuntimeKernel, from: string): Promise<UsageRecord[]> {
  const backend = deps.externalAgents;
  if (!backend) return [];
  const root = getPiwinRoot(deps.options.piwinRoot);
  const sessions = await listAllSessionRecords(getPiwinSessionIndexPath(root));
  const records: UsageRecord[] = [];
  const agentIds = new Set(sessions.flatMap((session) => session.backend ? [session.backend.agentId] : []));
  for (const agentId of agentIds) {
    const bound = sessions.filter((session) => session.backend?.agentId === agentId && session.backend.backendSessionId);
    try {
      const value = await backend.listRequestUsage(agentId, {
        from,
        sessions: bound.flatMap((session) => {
          const binding = session.backend;
          if (!binding?.backendSessionId) return [];
          return [{ backendSessionId: binding.backendSessionId,
            workingDirectory: session.workingDirectory ?? session.projectPath,
            ...(binding.modelId !== undefined ? { modelId: binding.modelId } : {}),
          }];
        }),
      });
      if (!Array.isArray(value)) throw new Error('catalog/usage must return an array');
      for (const entry of value) {
        if (typeof entry !== 'object' || entry === null) continue;
        const row = entry as Record<string, unknown>;
        if (typeof row.requestId !== 'string' || row.requestId.length === 0) continue;
        const session = bound.find((item) => item.backend?.backendSessionId === row.backendSessionId);
        if (!session) continue;
        const parsed = parseAssistantUsageMeasurement({ ...row,
          measurementId: `${agentId}:${row.requestId}`, sessionId: session.id, messageId: row.requestId,
        });
        const usage = parsed && normalizeUsageTokenSplit(parsed);
        if (!usage || !Number.isFinite(Date.parse(usage.recordedAt))) continue;
        const { sessionId, modelId, promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens,
          totalTokens, durationMs, firstTokenMs, recordedAt, measurementId, thinkingLevel,
          reasoningTokens, firstTokenKind, costUsd } = usage;
        records.push({ sessionId, projectPath: session.projectPath || null, totalTokens,
          recordedAt: new Date(recordedAt).toISOString(), measurementId, source: 'assistant-usage', timingScope: 'request',
          providerId: agentId,
          ...(modelId !== undefined ? { modelId } : {}),
          ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(completionTokens !== undefined ? { completionTokens } : {}),
          ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
          ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
          ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
          ...(firstTokenKind !== undefined ? { firstTokenKind } : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
        });
      }
    } catch (error) {
      deps.push({ type: 'host/log', level: 'warn', message: `backend request usage unavailable: ${formatError(error)}` });
    }
  }
  return records;
}

/**
 * Per-session usage totals for `usage/get-session` (`ComposerStatsLine`).
 *
 * Prices local transcript measurements and, when the session is bound to an
 * external backend with native `catalog/usage` accounting, merges the native
 * request history so historical / CLI-driven sessions populate the status bar.
 */
export async function readSessionUsageTotalsWithBackend(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<SessionUsageTotals> {
  const root = getPiwinRoot(deps.options.piwinRoot);
  const record = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
  const providerId = deps.sessionModels.get(sessionId)?.providerId ?? record?.backend?.agentId;
  const estimateCost = createSessionMeasurementCostEstimator(providerId);
  const localTotals = await (await deps.getTranscriptStore(sessionId)).readSessionUsageTotals(estimateCost);

  const binding = record?.backend;
  if (!record || !deps.externalAgents || !binding?.backendSessionId || binding.agentId === 'pi') {
    return localTotals;
  }
  try {
    const raw = await deps.externalAgents.listRequestUsage(binding.agentId, {
      from: '1970-01-01T00:00:00.000Z',
      sessions: [
        {
          backendSessionId: binding.backendSessionId,
          workingDirectory: record.workingDirectory ?? record.projectPath,
          ...(binding.modelId !== undefined ? { modelId: binding.modelId } : {}),
        },
      ],
    });
    if (!Array.isArray(raw) || raw.length === 0) {
      return localTotals;
    }
    const seenIds = new Set<string>();
    const measurements: AssistantUsageMeasurement[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.requestId !== 'string' || row.requestId.length === 0) continue;
      if (row.backendSessionId !== binding.backendSessionId) continue;
      const measurementId = `${binding.agentId}:${row.requestId}`;
      if (seenIds.has(measurementId)) continue;
      const parsed = parseAssistantUsageMeasurement({
        ...row,
        measurementId,
        sessionId,
        messageId: row.requestId,
      });
      const usage = parsed && normalizeUsageTokenSplit(parsed);
      if (!usage || !Number.isFinite(Date.parse(usage.recordedAt))) continue;
      seenIds.add(measurementId);
      measurements.push(usage);
    }
    if (measurements.length === 0) {
      return localTotals;
    }
    measurements.sort(
      (left, right) =>
        Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
        left.measurementId.localeCompare(right.measurementId),
    );
    const userTurnCount = localTotals.userTurnCount > 0 ? localTotals.userTurnCount : measurements.length;
    const catalogTotals = summarizeMeasurementsIntoSessionTotals(
      sessionId,
      measurements,
      userTurnCount,
      estimateCost,
    );
    if (localTotals.totalTokens > catalogTotals.totalTokens) {
      return localTotals;
    }
    // Preserve Host-measured turn timing (TTFT / duration) on the latest turn
    // when the vendor's disk JSONL stores token counts without stream clocks.
    const latestCatalog = catalogTotals.latestRequest;
    const latestLocal = localTotals.latestRequest;
    if (
      latestCatalog &&
      latestLocal &&
      localTotals.entryCount > 0 &&
      latestCatalog.durationMs === undefined &&
      latestLocal.durationMs !== undefined
    ) {
      catalogTotals.latestRequest = {
        ...latestCatalog,
        durationMs: latestLocal.durationMs,
        ...(latestLocal.firstTokenMs !== undefined ? { firstTokenMs: latestLocal.firstTokenMs } : {}),
        ...(latestLocal.firstTokenKind !== undefined ? { firstTokenKind: latestLocal.firstTokenKind } : {}),
      };
    }
    return catalogTotals;
  } catch {
    return localTotals;
  }
}
