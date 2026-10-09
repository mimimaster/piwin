import type { ModelCatalogEntry, ModelCatalogStatus } from './model-catalog.js';
import type { UsageRecord } from './usage.js';

/** Read-side reference prices, not the service's actual charge. */
export type UsageCostEstimate = {
  usd: number;
  /** The catalog provider/model used, which may differ from the configured Key. */
  reference: string;
};

export type UsageCostTotals = {
  /** Sum for priced entries only, at the current catalog rates. */
  estimatedCostUsd?: number;
  /** Omitted for older Hosts; unknown entries are not counted as free. */
  pricedEntryCount?: number;
};

export type UsagePricingCatalog = Pick<ModelCatalogStatus, 'source' | 'catalogVersion' | 'fetchedAt'>;

/** Pi usage separates uncached input from cache. Reasoning is already in output. */
export function estimateUsageCost(
  usage: UsageRecord,
  model: ModelCatalogEntry | undefined,
): UsageCostEstimate | undefined {
  if (!model?.cost || usage.source !== 'assistant-usage') return undefined;
  // Cached catalog JSON from older Hosts may be structurally incomplete.
  if (model.missingCostFields !== undefined && !Array.isArray(model.missingCostFields)) return undefined;
  // A total-only legacy/occupancy record cannot be priced from a guessed split.
  if (usage.promptTokens === undefined || usage.completionTokens === undefined) return undefined;
  const tokens = {
    input: usage.promptTokens,
    output: usage.completionTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
  };
  const keys = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
  if (keys.some((key) => !isNonNegativeFinite(tokens[key]))) return undefined;
  const sum = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  if (!isNonNegativeFinite(usage.totalTokens) || sum !== usage.totalTokens) return undefined;
  if (keys.some((key) => !isNonNegativeFinite(model.cost[key]))) return undefined;
  // Old snapshots collapsed missing rates to zero. Do not invent a free price.
  if (model.missingCostFields === undefined && keys.every((key) => model.cost[key] === 0)) {
    return undefined;
  }
  for (const key of keys) {
    if (tokens[key] === 0) continue;
    if (model.missingCostFields?.includes(key)) return undefined;
    if (model.missingCostFields === undefined && model.cost[key] === 0) return undefined;
  }
  const usd = keys.reduce((cost, key) => cost + tokens[key] * model.cost[key] / 1_000_000, 0);
  if (!isNonNegativeFinite(usd)) return undefined;
  return { usd, reference: `${model.catalogProviderId}/${model.modelId}` };
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
