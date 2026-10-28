/**
 * Pure view model for the reference-cost readout on the usage page.
 *
 * Cost is one summary metric among the existing ones, with details on demand.
 * Unknown is never shown as free: old Hosts and unpriced records stay `—`.
 */
import type { UsageModelKeyTotal, UsageRollup } from '@piwin/contracts';

export type UsageCostState = 'unsupported' | 'empty' | 'complete' | 'partial' | 'unpriced';

export type UsageCostOverview = {
  state: UsageCostState;
  /** Priced-only total; undefined when nothing could be priced. */
  totalUsd: number | undefined;
  pricedCount: number;
  unpricedCount: number;
  entryCount: number;
};

export function resolveUsageCostOverview(
  rollup: Pick<UsageRollup, 'entryCount' | 'estimatedCostUsd' | 'pricedEntryCount'>,
): UsageCostOverview {
  const entryCount = Math.max(0, rollup.entryCount);
  const priced = rollup.pricedEntryCount;
  if (priced === undefined) {
    return { state: 'unsupported', totalUsd: undefined, pricedCount: 0, unpricedCount: 0, entryCount };
  }
  const pricedCount = Math.min(Math.max(0, priced), entryCount);
  const unpricedCount = entryCount - pricedCount;
  if (entryCount === 0) {
    return { state: 'empty', totalUsd: 0, pricedCount: 0, unpricedCount: 0, entryCount };
  }
  if (pricedCount === 0) {
    return { state: 'unpriced', totalUsd: undefined, pricedCount, unpricedCount, entryCount };
  }
  return {
    state: unpricedCount > 0 ? 'partial' : 'complete',
    totalUsd: rollup.estimatedCostUsd,
    pricedCount,
    unpricedCount,
    entryCount,
  };
}

/** Headline amount: readable cents, tiny positive amounts never read as free. */
export function formatUsageUsdSummary(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Averages (per day, per call) keep a third decimal below $1 so small rates stay distinct. */
export function formatUsageUsdAverage(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.001) return '<$0.001';
  const digits = value >= 1 ? 2 : 3;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export type UsageCostReferenceMapping = { modelId: string; reference: string };

/** Only mappings that add information: the reference differs from the shown model. */
export function listUsageCostReferenceMappings(
  rows: readonly UsageModelKeyTotal[],
): UsageCostReferenceMapping[] {
  const seen = new Set<string>();
  const mappings: UsageCostReferenceMapping[] = [];
  for (const row of rows) {
    const reference = row.costReference;
    if (!reference || reference === row.modelId) continue;
    const key = `${row.modelId}\u0000${reference}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mappings.push({ modelId: row.modelId, reference });
  }
  return mappings.sort((left, right) => left.modelId.localeCompare(right.modelId));
}
