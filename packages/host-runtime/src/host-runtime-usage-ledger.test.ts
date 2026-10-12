import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readUsageCallLog } from '@piwin/session';
import type { AssistantUsageMeasurement } from '@piwin/contracts';
import { recordFinalizedUsageToLedger } from './host-runtime-usage-ledger.js';
import { getPiwinUsageLedgerPath } from './paths.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function measurement(sessionId: string, id: string): AssistantUsageMeasurement {
  return {
    sessionId,
    measurementId: id,
    messageId: `msg-${id}`,
    recordedAt: new Date().toISOString(),
    totalTokens: 1200,
    promptTokens: 1000,
    completionTokens: 200,
  } as AssistantUsageMeasurement;
}

describe('recordFinalizedUsageToLedger', () => {
  it('records subagent child calls under the parent project and tags the parent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-usage-'));
    roots.push(root);
    const deps = {
      options: { piwinRoot: root },
      sessionProjects: new Map([['parent', '/repo']]),
      sessionModels: new Map([['child', { providerId: 'p1', modelId: 'm-sub' }]]),
      sessionThinkingLevels: new Map(),
      sessionUsage: new Map(),
      subagentSessionContexts: new Map([['child', { parentSessionId: 'parent' }]]),
      push: () => undefined,
    } as unknown as HostRuntimeKernel;

    await expect(recordFinalizedUsageToLedger(deps, 'child', measurement('child', 'a'))).resolves.toBe('inserted');
    await expect(recordFinalizedUsageToLedger(deps, 'child', measurement('child', 'a'))).resolves.toBe('duplicate');

    const log = await readUsageCallLog(getPiwinUsageLedgerPath(root), {
      scope: { kind: 'project', projectPath: '/repo' } as never,
    });
    expect(log.totalInWindow).toBe(1);
    expect(log.entries[0]).toMatchObject({
      sessionId: 'child',
      parentSessionId: 'parent',
      projectPath: '/repo',
      modelId: 'm-sub',
      providerId: 'p1',
    });
  });
});
