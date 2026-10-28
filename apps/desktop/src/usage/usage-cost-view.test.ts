import { describe, expect, it } from 'vitest';
import type { UsageModelKeyTotal } from '@piwin/contracts';
import {
  formatUsageUsdSummary,
  listUsageCostReferenceMappings,
  formatUsageUsdAverage,
  resolveUsageCostOverview,
} from './usage-cost-view';

function row(modelId: string, providerId: string, cost: number | undefined, totalTokens = 100, reference?: string): UsageModelKeyTotal {
  return {
    modelId, providerId, promptTokens: totalTokens, completionTokens: 0, cacheReadTokens: 0,
    cacheWriteTokens: 0, totalTokens, entryCount: 1,
    ...(cost !== undefined ? { estimatedCostUsd: cost, pricedEntryCount: 1 } : { pricedEntryCount: 0 }),
    ...(reference ? { costReference: reference } : {}),
  };
}

describe('usage-cost-view', () => {
  it('treats an old Host as unsupported, never as free', () => {
    expect(resolveUsageCostOverview({ entryCount: 3 })).toMatchObject({ state: 'unsupported', totalUsd: undefined });
  });

  it('shows zero requests as a real $0.00', () => {
    expect(resolveUsageCostOverview({ entryCount: 0, pricedEntryCount: 0 })).toMatchObject({ state: 'empty', totalUsd: 0 });
  });

  it('distinguishes complete, partial and fully unpriced coverage', () => {
    expect(resolveUsageCostOverview({ entryCount: 3, pricedEntryCount: 3, estimatedCostUsd: 0.5 }))
      .toEqual({ state: 'complete', totalUsd: 0.5, pricedCount: 3, unpricedCount: 0, entryCount: 3 });
    expect(resolveUsageCostOverview({ entryCount: 3, pricedEntryCount: 2, estimatedCostUsd: 0.5 }))
      .toEqual({ state: 'partial', totalUsd: 0.5, pricedCount: 2, unpricedCount: 1, entryCount: 3 });
    expect(resolveUsageCostOverview({ entryCount: 3, pricedEntryCount: 0, estimatedCostUsd: 0 }))
      .toEqual({ state: 'unpriced', totalUsd: undefined, pricedCount: 0, unpricedCount: 3, entryCount: 3 });
  });

  it('clamps inconsistent counts from the Host', () => {
    expect(resolveUsageCostOverview({ entryCount: 2, pricedEntryCount: 5, estimatedCostUsd: 1 }))
      .toMatchObject({ state: 'complete', pricedCount: 2, unpricedCount: 0 });
  });

  it('formats headline amounts to cents without rounding tiny costs to free', () => {
    expect(formatUsageUsdSummary(undefined)).toBe('—');
    expect(formatUsageUsdSummary(Number.NaN)).toBe('—');
    expect(formatUsageUsdSummary(-0.5)).toBe('—');
    expect(formatUsageUsdSummary(0)).toBe('$0.00');
    expect(formatUsageUsdSummary(0.004)).toBe('<$0.01');
    expect(formatUsageUsdSummary(0.384)).toBe('$0.38');
    expect(formatUsageUsdSummary(1234.567)).toBe('$1,234.57');
  });

  it('formats averages with a third decimal below a dollar', () => {
    expect(formatUsageUsdAverage(undefined)).toBe('—');
    expect(formatUsageUsdAverage(0)).toBe('$0.00');
    expect(formatUsageUsdAverage(0.0004)).toBe('<$0.001');
    expect(formatUsageUsdAverage(0.1974)).toBe('$0.197');
    expect(formatUsageUsdAverage(136.371)).toBe('$136.37');
  });

  it('lists only reference mappings that differ from the model name, once', () => {
    expect(listUsageCostReferenceMappings([
      row('gpt-5', 'work', 0.1, 1, 'openai/gpt-5'),
      row('gpt-5', 'personal', 0.1, 1, 'openai/gpt-5'),
      row('same', 'work', 0.1, 1, 'same'),
      row('none', 'work', undefined),
    ])).toEqual([{ modelId: 'gpt-5', reference: 'openai/gpt-5' }]);
  });
});
