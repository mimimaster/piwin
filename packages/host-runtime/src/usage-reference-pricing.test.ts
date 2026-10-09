import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installModelCatalogSnapshot, resetModelCatalogSnapshot } from '@piwin/agent-host';
import type { ModelCatalogEntry, UsageCallLog, UsageRecord, UsageRollup } from '@piwin/contracts';
import { createUsageCostEstimator } from './usage-reference-pricing.js';
import { handleUsageCommand } from './commands/usage-commands.js';
import type { HostCommandContext } from './commands/host-command-context.js';

const model: ModelCatalogEntry = {
  catalogProviderId: 'native', modelId: 'cost-test', name: 'Cost test', input: ['text'], reasoning: true,
  contextWindow: 200_000, maxTokens: 8_000,
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, missingCostFields: [],
};
const usage: UsageRecord = {
  sessionId: 's', projectPath: null, providerId: 'custom-key', modelId: 'cost-test',
  promptTokens: 1_000, completionTokens: 100, cacheReadTokens: 2_000, cacheWriteTokens: 500,
  totalTokens: 3_600, source: 'assistant-usage', recordedAt: new Date(Date.now() - 5_000).toISOString(),
};
function install(entries: ModelCatalogEntry[], version = 'models.dev@test'): void {
  installModelCatalogSnapshot({ source: 'models.dev', catalogVersion: version,
    fetchedAt: '2026-10-09T00:00:00Z', imageEntries: [], entries });
}

afterEach(() => resetModelCatalogSnapshot());

describe('usage reference pricing', () => {
  it('reuses catalog matching for a custom Key and discloses the reference provider', () => {
    install([model]);
    const cost = createUsageCostEstimator()(usage);
    expect(cost?.usd).toBeCloseTo(0.006975, 12);
    expect(cost?.reference).toBe('native/cost-test');
    expect(createUsageCostEstimator()({ ...usage, modelId: 'not-in-the-catalog' })).toBeUndefined();
  });

  it('prefers an exact provider match instead of another provider with the same model id', () => {
    install([{ ...model, catalogProviderId: 'first', cost: { ...model.cost, output: 150 } }, model]);
    const cost = createUsageCostEstimator()({ ...usage, providerId: 'native' });
    expect(cost?.reference).toBe('native/cost-test');
    expect(cost?.usd).toBeCloseTo(0.006975, 12);
  });

  it('re-estimates old records with current prices, without rewriting the token ledger', async () => {
    install([model]);
    const root = await mkdtemp(join(tmpdir(), 'piwin-reference-cost-'));
    const path = join(root, 'usage', 'ledger.jsonl');
    await mkdir(join(root, 'usage'));
    const raw = `${JSON.stringify(usage)}\n${JSON.stringify({ ...usage, modelId: 'unknown' })}\n`;
    await writeFile(path, raw);
    const context = { piwinRoot: root } as HostCommandContext;
    const first = await handleUsageCommand({ type: 'usage/get-rollup' }, 'a', context);
    if (!first?.success) throw new Error('expected rollup');
    const rollup = (first.data as { rollup: UsageRollup }).rollup;
    expect(rollup.estimatedCostUsd).toBeCloseTo(0.006975, 12);
    expect(rollup.pricedEntryCount).toBe(1);
    expect(rollup.entryCount).toBe(2);
    expect(rollup.pricingCatalog).toMatchObject({ source: 'models.dev', catalogVersion: 'models.dev@test' });
    install([{ ...model, cost: { input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 } }], 'models.dev@updated');
    const next = await handleUsageCommand({ type: 'usage/get-rollup' }, 'b', context);
    if (!next?.success) throw new Error('expected updated rollup');
    expect((next.data as { rollup: UsageRollup }).rollup.estimatedCostUsd).toBeCloseTo(0.01395, 12);
    expect(await readFile(path, 'utf8')).toBe(raw);
  });

  it('prices backend request details in recent calls using the same catalog', async () => {
    install([model]);
    const root = await mkdtemp(join(tmpdir(), 'piwin-reference-calls-'));
    const context = { piwinRoot: root, getBackendRequestUsage: async () => [usage] } as unknown as HostCommandContext;
    const response = await handleUsageCommand({ type: 'usage/list-recent' }, 'c', context);
    if (!response?.success) throw new Error('expected calls');
    const log = (response.data as { log: UsageCallLog }).log;
    expect(log.entries[0]?.cost?.usd).toBeCloseTo(0.006975, 12);
    expect(log.pricingCatalog?.source).toBe('models.dev');
  });
});
