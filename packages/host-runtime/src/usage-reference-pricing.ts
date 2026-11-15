import { lookupCatalogByModelId, searchPiCatalog } from '@piwin/agent-host';
import {
  estimateUsageCost,
  type AssistantUsageMeasurement,
  type ModelCatalogEntry,
  type UsageCostEstimate,
  type UsageRecord,
} from '@piwin/contracts';

/** One synchronous read-side pass; no network, credentials, or ledger writes. */
export function createUsageCostEstimator(): (record: UsageRecord) => UsageCostEstimate | undefined {
  const models = new Map<string, ModelCatalogEntry | undefined>();
  return (record) => {
    const modelId = record.modelId?.trim();
    const providerId = record.providerId?.trim();
    if (modelId) {
      const key = JSON.stringify([providerId, modelId]);
      if (!models.has(key)) {
        // Configured provider ids need not be catalog ids. Prefer the exact
        // provider when it is one; otherwise disclose the existing reference match.
        const providerMatch = providerId
          ? searchPiCatalog({ query: modelId, catalogProviderId: providerId, limit: 200 }).entries.find(
            (entry) => entry.modelId.toLowerCase() === modelId.toLowerCase(),
          )
          : undefined;
        models.set(key, providerMatch ?? lookupCatalogByModelId(modelId));
      }
      const catalogEstimate = estimateUsageCost(record, models.get(key));
      if (catalogEstimate !== undefined) return catalogEstimate;
    }
    if (typeof record.costUsd === 'number' && Number.isFinite(record.costUsd) && record.costUsd >= 0) {
      return {
        usd: record.costUsd,
        reference: `${providerId || 'backend'}/${modelId || 'reported'}`,
      };
    }
    return undefined;
  };
}

/** Adapt the shared reference-pricing pass to per-session assistant measurements. */
export function createSessionMeasurementCostEstimator(
  providerId?: string,
): (measurement: AssistantUsageMeasurement) => number | undefined {
  const estimator = createUsageCostEstimator();
  return (measurement) => {
    const estimate = estimator({
      sessionId: measurement.sessionId,
      projectPath: null,
      ...(providerId ? { providerId } : {}),
      ...(measurement.modelId !== undefined ? { modelId: measurement.modelId } : {}),
      ...(measurement.promptTokens !== undefined ? { promptTokens: measurement.promptTokens } : {}),
      ...(measurement.completionTokens !== undefined ? { completionTokens: measurement.completionTokens } : {}),
      ...(measurement.cacheReadTokens !== undefined ? { cacheReadTokens: measurement.cacheReadTokens } : {}),
      ...(measurement.cacheWriteTokens !== undefined ? { cacheWriteTokens: measurement.cacheWriteTokens } : {}),
      ...(measurement.costUsd !== undefined ? { costUsd: measurement.costUsd } : {}),
      totalTokens: measurement.totalTokens,
      source: 'assistant-usage',
      recordedAt: measurement.recordedAt,
    });
    return estimate?.usd;
  };
}
