import { lookupCatalogByModelId, searchPiCatalog } from '@piwin/agent-host';
import { estimateUsageCost, type ModelCatalogEntry, type UsageCostEstimate, type UsageRecord } from '@piwin/contracts';

/** One synchronous read-side pass; no network, credentials, or ledger writes. */
export function createUsageCostEstimator(): (record: UsageRecord) => UsageCostEstimate | undefined {
  const models = new Map<string, ModelCatalogEntry | undefined>();
  return (record) => {
    const modelId = record.modelId?.trim();
    if (!modelId) return undefined;
    const providerId = record.providerId?.trim();
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
    return estimateUsageCost(record, models.get(key));
  };
}
