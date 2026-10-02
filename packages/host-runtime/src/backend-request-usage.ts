import { formatError, parseAssistantUsageMeasurement, type UsageRecord } from '@piwin/contracts';
import { listAllSessionRecords } from '@piwin/session';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';

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
        const usage = parseAssistantUsageMeasurement({ ...row,
          measurementId: `${agentId}:${row.requestId}`, sessionId: session.id, messageId: row.requestId,
        });
        if (!usage || !Number.isFinite(Date.parse(usage.recordedAt))) continue;
        const { sessionId, modelId, promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens,
          totalTokens, durationMs, firstTokenMs, recordedAt, measurementId, thinkingLevel } = usage;
        records.push({ sessionId, projectPath: session.projectPath || null, totalTokens,
          recordedAt: new Date(recordedAt).toISOString(), measurementId, source: 'assistant-usage', timingScope: 'request',
          ...(modelId !== undefined ? { modelId } : {}),
          ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(completionTokens !== undefined ? { completionTokens } : {}),
          ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
          ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
        });
      }
    } catch (error) {
      deps.push({ type: 'host/log', level: 'warn', message: `backend request usage unavailable: ${formatError(error)}` });
    }
  }
  return records;
}
