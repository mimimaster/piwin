import type { UsageBucket, UsageCallLog, UsageCostEstimate, UsageRecord, UsageRollup } from '@piwin/contracts';
import { estimateUsageCost } from '@piwin/contracts';
import { summarizeUsageCallEntries } from '../usage/usage-panel-statistics.js';

/** Deterministic usage fixtures; synthetic prices are not vendor quotes. */
export function createMockUsageRollup(projectPath: string | undefined, modelId?: string): UsageRollup {
  const day = (offset: number): string => {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  };
  const byDay: Record<string, UsageBucket> = {
    [day(12)]: usageBucket(15_000, 5_000, 20_000, 4_000, 6),
    [day(10)]: usageBucket(20_000, 6_000, 24_000, 2_000, 8),
    [day(8)]: usageBucket(12_000, 4_000, 18_000, 2_000, 5),
    [day(6)]: usageBucket(25_000, 8_000, 31_000, 4_000, 10),
    [day(4)]: usageBucket(28_000, 7_000, 35_000, 4_000, 12),
    [day(2)]: usageBucket(21_000, 7_000, 30_000, 3_000, 9),
    [day(0)]: usageBucket(36_000, 7_000, 40_000, 6_000, 16),
  };
  const rollup: UsageRollup = {
    scope: projectPath ? { kind: 'project', projectPath } : { kind: 'global' },
    ...usageBucket(157_000, 44_000, 198_000, 25_000, 66),
    pricingCatalog: { source: 'models.dev', catalogVersion: 'models.dev@mock-synthetic-prices', fetchedAt: `${day(0)}T00:00:00Z` },
    sessionCount: 12,
    firstAt: `${day(12)}T08:00:00.000Z`,
    lastAt: `${day(0)}T12:00:00.000Z`,
    byModel: {
      'gpt-5.2-codex': usageBucket(122_000, 30_000, 156_000, 20_000, 50),
      'claude-sonnet-4-5': usageBucket(35_000, 14_000, 42_000, 5_000, 16),
    },
    byModelKey: [
      {
        providerId: 'openai-work',
        modelId: 'gpt-5.2-codex',
        costReference: 'mock/gpt-5.2-codex',
        ...usageBucket(78_000, 18_000, 132_000, 12_000, 32),
      },
      {
        providerId: 'anthropic-main',
        modelId: 'claude-sonnet-4-5',
        costReference: 'mock/claude-sonnet-4-5',
        ...usageBucket(35_000, 14_000, 42_000, 5_000, 16),
      },
      {
        providerId: 'openai-personal',
        modelId: 'gpt-5.2-codex',
        costReference: 'mock/gpt-5.2-codex',
        ...usageBucket(44_000, 12_000, 24_000, 8_000, 18),
      },
    ],
    byDay,
    bySession: [],
  };
  const availableModels = Object.keys(rollup.byModel).sort();
  if (modelId === undefined) return { ...rollup, availableModels };
  const selected = rollup.byModel[modelId] ?? usageBucket(0, 0, 0, 0, 0);
  const weights = Object.values(byDay).map((bucket) => bucket.totalTokens / rollup.totalTokens);
  const keys = ['promptTokens', 'completionTokens', 'cacheReadTokens', 'cacheWriteTokens', 'entryCount'] as const;
  const remaining = keys.map((key) => selected[key]);
  const days = Object.keys(byDay);
  const modelDays = Object.fromEntries(days.map((day, index) => {
    const values = keys.map((key, keyIndex) => {
      const value = index === days.length - 1 ? remaining[keyIndex] ?? 0 : Math.floor(selected[key] * (weights[index] ?? 0));
      remaining[keyIndex] = (remaining[keyIndex] ?? 0) - value;
      return value;
    });
    return [day, usageBucket(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0, values[4] ?? 0)];
  }));
  return { ...rollup, ...selected, availableModels, sessionCount: selected.entryCount > 0 ? 3 : 0,
    byModel: selected.entryCount > 0 ? { [modelId]: selected } : {},
    byModelKey: rollup.byModelKey.filter((bucket) => bucket.modelId === modelId), byDay: modelDays };
}

/**
 * Deterministic call log for the browser mock. Generates enough rows to page
 * through, spread across the requested window, so the table, the summary and
 * the pager all have something real to render.
 */
export function createMockUsageCallLog(
  projectPath: string | undefined,
  windowMinutes: number,
  limit: number,
  offset: number,
  modelId?: string,
): UsageCallLog {
  const now = Date.now();
  const models = [
    { modelId: 'gpt-5.2-codex', providerId: 'openai-work' },
    { modelId: 'claude-sonnet-4-5', providerId: 'anthropic-main' },
    { modelId: 'gpt-5.2-codex', providerId: 'openai-personal' },
  ];
  const total = 137;
  const spacingMs = Math.max(1, Math.floor((windowMinutes * 60_000) / total));
  const all = Array.from({ length: total }, (_, index) => {
    const model = models[index % models.length] ?? models[0]!;
    // Every 7th call misses the cache, so the hit/miss column is not uniform.
    const missed = index % 7 === 0;
    const promptTokens = missed ? 24_000 + index * 37 : 1_200 + index * 11;
    const completionTokens = 60 + ((index * 53) % 900);
    const cacheReadTokens = missed ? 0 : 90_000 + index * 613;
    const cacheWriteTokens = missed ? 4_200 : 0;
    return {
      id: `mock-call-${index}`,
      recordedAt: new Date(now - index * spacingMs - 20_000).toISOString(),
      // Every 5th call comes from a subagent child of the first session.
      sessionId: index % 5 === 2 ? `mock-subagent-${index}` : `mock-session-${(index % 4) + 1}`,
      ...(index % 5 === 2 ? { parentSessionId: 'mock-session-1' } : {}),
      projectPath: projectPath ?? null,
      providerId: model.providerId,
      modelId: model.modelId,
      promptTokens,
      completionTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens,
      durationMs: 2_400 + ((index * 911) % 26_000),
      source: 'assistant-usage' as const,
      cost: mockUsageCost({ promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens }, model.modelId),
    };
  });
  const filtered = all.filter((entry) => modelId === undefined || entry.modelId === modelId);
  const safeOffset = Math.min(Math.max(0, offset), Math.max(0, (Math.ceil(filtered.length / limit) - 1) * limit));
  const entries = filtered.slice(safeOffset, safeOffset + limit);
  return {
    windowMinutes,
    from: new Date(now - windowMinutes * 60_000).toISOString(),
    to: new Date(now).toISOString(),
    entries,
    offset: safeOffset,
    limit,
    totalInWindow: filtered.length,
    truncated: filtered.length > entries.length,
    windowSummary: summarizeUsageCallEntries(filtered),
  };
}

function usageBucket(
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  entryCount: number,
): UsageBucket {
  return {
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens,
    entryCount,
    estimatedCostUsd: mockUsageCost({ promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens }).usd,
    pricedEntryCount: entryCount,
  };
}

/** Synthetic test prices, not vendor quotes. Uses the same contract arithmetic. */
function mockUsageCost(
  tokens: Pick<UsageRecord, 'promptTokens' | 'completionTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>,
  modelId = 'mock-reference',
): UsageCostEstimate {
  const cost = estimateUsageCost({
    ...tokens, sessionId: 'mock', projectPath: null, source: 'assistant-usage', recordedAt: '',
    totalTokens: (tokens.promptTokens ?? 0) + (tokens.completionTokens ?? 0)
      + (tokens.cacheReadTokens ?? 0) + (tokens.cacheWriteTokens ?? 0),
  }, {
    catalogProviderId: 'mock', modelId, name: modelId, input: ['text'], reasoning: false,
    contextWindow: 200_000, maxTokens: 8_000, missingCostFields: [],
    cost: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 1.25 },
  });
  if (!cost) throw new Error('invalid mock usage cost');
  return cost;
}

