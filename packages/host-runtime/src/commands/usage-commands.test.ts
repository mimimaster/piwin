import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostResponse, UsageCallLog, UsageRecord, UsageRollup } from '@piwin/contracts';
import { handleUsageCommand, isUsageCommand } from './usage-commands.js';
import type { HostCommandContext } from './host-command-context.js';

async function seedLedger(records: UsageRecord[]): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-usage-cmd-'));
  const ledgerPath = join(rootDir, 'usage', 'ledger.jsonl');
  await mkdir(join(rootDir, 'usage'), { recursive: true });
  await writeFile(ledgerPath, `${records.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return rootDir;
}

function okData<T>(response: HostResponse | null): T {
  if (!response || !response.success) {
    throw new Error(`expected a successful response, got ${JSON.stringify(response)}`);
  }
  return response.data as T;
}

function context(piwinRoot: string): HostCommandContext {
  // handleUsageCommand only reads the ledger under piwinRoot.
  return { piwinRoot } as unknown as HostCommandContext;
}

function usageRecord(partial: Partial<UsageRecord>): UsageRecord {
  return {
    sessionId: 's1',
    projectPath: '/tmp/proj',
    modelId: 'gpt-4o',
    providerId: 'work-key',
    promptTokens: 100,
    completionTokens: 20,
    cacheReadTokens: 800,
    cacheWriteTokens: 0,
    totalTokens: 920,
    source: 'assistant-usage',
    recordedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('usage commands', () => {
  it('routes both usage reads', () => {
    expect(isUsageCommand({ type: 'usage/get-rollup' })).toBe(true);
    expect(isUsageCommand({ type: 'usage/list-recent' })).toBe(true);
    expect(isUsageCommand({ type: 'host/ping' })).toBe(false);
  });

  it('returns recent calls newest first and leaves the all-time rollup intact', async () => {
    const hourAgo = new Date(Date.now() - 90 * 60_000).toISOString();
    const rootDir = await seedLedger([
      usageRecord({ sessionId: 'stale', recordedAt: hourAgo }),
      usageRecord({
        sessionId: 'older',
        recordedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      }),
      usageRecord({ sessionId: 'newest', recordedAt: new Date().toISOString() }),
    ]);

    const recent = await handleUsageCommand(
      { type: 'usage/list-recent' },
      'req-1',
      context(rootDir),
    );
    const log = okData<{ log: UsageCallLog }>(recent).log;
    expect(log.windowMinutes).toBe(60);
    expect(log.entries.map((entry) => entry.sessionId)).toEqual(['newest', 'older']);

    const rollup = await handleUsageCommand(
      { type: 'usage/get-rollup' },
      'req-2',
      context(rootDir),
    );
    expect(okData<{ rollup: UsageRollup }>(rollup).rollup.entryCount).toBe(3);
  });

  it('honours the requested window and row cap', async () => {
    const rootDir = await seedLedger([
      usageRecord({ sessionId: 'a', recordedAt: new Date(Date.now() - 20 * 60_000).toISOString() }),
      usageRecord({ sessionId: 'b', recordedAt: new Date(Date.now() - 2 * 60_000).toISOString() }),
    ]);

    const narrow = await handleUsageCommand(
      { type: 'usage/list-recent', windowMinutes: 5 },
      'req-3',
      context(rootDir),
    );
    expect(okData<{ log: UsageCallLog }>(narrow).log.entries).toHaveLength(1);

    const capped = await handleUsageCommand(
      { type: 'usage/list-recent', limit: 1 },
      'req-4',
      context(rootDir),
    );
    const cappedLog = okData<{ log: UsageCallLog }>(capped).log;
    expect(cappedLog.entries).toHaveLength(1);
    expect(cappedLog.truncated).toBe(true);
    expect(cappedLog.totalInWindow).toBe(2);
  });

  it('serves the requested page of the window', async () => {
    const rootDir = await seedLedger([
      usageRecord({ sessionId: 'a', recordedAt: new Date(Date.now() - 3 * 60_000).toISOString() }),
      usageRecord({ sessionId: 'b', recordedAt: new Date(Date.now() - 2 * 60_000).toISOString() }),
      usageRecord({ sessionId: 'c', recordedAt: new Date(Date.now() - 1 * 60_000).toISOString() }),
    ]);

    const page = await handleUsageCommand(
      { type: 'usage/list-recent', limit: 2, offset: 2 },
      'req-5',
      context(rootDir),
    );
    const log = okData<{ log: UsageCallLog }>(page).log;
    expect(log.offset).toBe(2);
    expect(log.limit).toBe(2);
    expect(log.totalInWindow).toBe(3);
    expect(log.entries.map((entry) => entry.sessionId)).toEqual(['a']);
  });
});
