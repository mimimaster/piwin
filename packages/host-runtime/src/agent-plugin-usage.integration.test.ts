import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeTokensPerSecond, type HostPush, type HostResponse, type UsageCallLog } from '@piwin/contracts';
import { installExtension } from '@piwin/extensions';
import { HostRuntime } from './host-runtime.js';
import { installFixtureAgentAdapter } from './testing/agent-plugin-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function data(response: HostResponse): unknown {
  if (!response.success) throw new Error(response.error);
  return response.data;
}

async function harness(script: unknown) {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plugin-usage-'));
  const installed = await installFixtureAgentAdapter(rootDir, { script });
  const runtime = new HostRuntime({
    mode: 'sdk', mock: true, piwinRoot: rootDir, externalAgents: { env: installed.env },
  });
  cleanups.push(async () => { await runtime.dispose(); await rm(rootDir, { recursive: true, force: true }); });
  const pushes: HostPush[] = [];
  runtime.attachPushSink({ id: 'usage-test', push: (push) => pushes.push(push) });
  const { sessionId } = data(await runtime.handleCommand({
    type: 'session/create', input: { agentId: installed.agentId, projectPath: rootDir },
  })) as { sessionId: string };
  return { rootDir, runtime, pushes, sessionId };
}

describe('Plugin turn timing in Host usage statistics', () => {
  it('records first-token delay and aggregate TPS once through the existing usage ledger', async () => {
    const { runtime, pushes, sessionId } = await harness({
      steps: [{ kind: 'delay', ms: 25 }, { kind: 'text', text: 'first' },
        { kind: 'delay', ms: 60 }, { kind: 'text', text: 'last' }],
      usage: { modelId: 'grok-test', promptTokens: 40, completionTokens: 200,
        totalTokens: 240, durationMs: 1 },
    });
    data(await runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'test' } }));
    await vi.waitFor(() => expect(pushes.some((push) => push.type === 'run/terminal')).toBe(true));
    await vi.waitFor(async () => {
      const { log } = data(await runtime.handleCommand({ type: 'usage/list-recent' })) as { log: UsageCallLog };
      expect(log.entries).toHaveLength(1);
      const entry = log.entries[0];
      expect(entry).toMatchObject({ sessionId, modelId: 'grok-test', completionTokens: 200,
        totalTokens: 240, timingScope: 'turn' });
      if (!entry) throw new Error('missing usage entry');
      expect(entry.firstTokenMs).toBeGreaterThanOrEqual(20);
      expect(entry.durationMs).toBeGreaterThanOrEqual(75);
      expect(computeTokensPerSecond(entry)).toBeGreaterThan(0);
    });
    expect(pushes).toContainEqual(expect.objectContaining({
      type: 'event', sessionId, event: expect.objectContaining({
        type: 'usage/update', usage: expect.objectContaining({
          timingScope: 'turn', firstTokenMs: expect.any(Number), durationMs: expect.any(Number),
        }),
      }),
    }));
  });

  it('shows every completed model request before the plugin turn has ended', async () => {
    const recordedAt = new Date().toISOString();
    const requestUsage = ['request-1', 'request-2'].map((requestId) => ({
      requestId, backendSessionId: 'fixture-session-1', modelId: 'grok-test',
      promptTokens: 40, completionTokens: 200, totalTokens: 240,
      durationMs: 2500, firstTokenMs: 500, timingScope: 'request', recordedAt,
    }));
    const script = {
      steps: [{ kind: 'text', text: 'still working' }, { kind: 'hang' }],
      requestUsage: [...requestUsage,
        { ...requestUsage[0], backendSessionId: 'unbound-native-session', requestId: 'foreign' },
        { ...requestUsage[0], completionTokens: -5, requestId: 'invalid' },
      ],
    };
    const { rootDir, runtime, pushes, sessionId } = await harness(script);
    data(await runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'test' } }));
    await vi.waitFor(() => expect(pushes.some((push) => push.type === 'event'
      && push.event.type === 'message/text_delta')).toBe(true));
    const { log } = data(await runtime.handleCommand({ type: 'usage/list-recent' })) as { log: UsageCallLog };
    expect(log.totalInWindow).toBe(2);
    expect(log.entries.every((entry) => entry.sessionId === sessionId)).toBe(true);
    expect(log.entries[0]).toMatchObject({ timingScope: 'request', firstTokenMs: 500, durationMs: 2500 });
    const entry = log.entries[0];
    if (!entry) throw new Error('missing request usage');
    expect(computeTokensPerSecond(entry)).toBe(100);
    expect(pushes.some((push) => push.type === 'run/terminal')).toBe(false);

    // Updating the selected extension refreshes only the independent control process.
    // The session process is still executing the original turn and remains cancellable.
    await writeFile(join(rootDir, 'fixture-script.json'), JSON.stringify({ ...script,
      requestUsage: [...requestUsage, { ...requestUsage[0], requestId: 'request-3' }],
    }));
    const source = join(rootDir, 'fixture-extension-source');
    await writeFile(join(source, 'revision-marker.txt'), 'updated');
    await installExtension({ piwinRoot: rootDir, source: { kind: 'local', path: source }, name: 'fixture' });
    const refreshed = data(await runtime.handleCommand({ type: 'usage/list-recent' })) as { log: UsageCallLog };
    expect(refreshed.log.totalInWindow).toBe(3);
    expect(pushes.some((push) => push.type === 'run/terminal')).toBe(false);
    data(await runtime.handleCommand({ type: 'session/abort', sessionId }));
    await vi.waitFor(() => expect(pushes.some((push) => push.type === 'run/terminal')).toBe(true));
  });
});
