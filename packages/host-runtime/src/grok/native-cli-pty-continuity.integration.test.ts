import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { AgentCliOpenData, HostPush } from '@piwin/contracts';
import { HostRuntime } from '../host-runtime.js';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { installFixtureAgentAdapter } from '../testing/agent-plugin-fixture.js';

it('keeps an actual Host PTY alive through detach, Desktop snapshot and reattach', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piwin-native-pty-continuity-'));
  const fixture = await installFixtureAgentAdapter(root, {
    agentId: 'fixture-cli',
    script: {
      backendSessionId: 'native-exact-id', binaryPath: '/bin/sh',
      nativeCli: { supported: true },
      capabilities: { agentId: 'fixture-cli', operations: {}, nativeCli: { supported: true } },
      cliLaunchArgs: ['-c', 'printf READY; while IFS= read -r input; do printf "ACK:%s" "$input"; done', 'native-exact-id'],
    },
  });
  const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: root, externalAgents: { env: fixture.env } });
  const pushes: HostPush[] = [];
  runtime.attachPushSink({ id: 'continuity', push: (push) => pushes.push(push) });
  try {
    const kernel = runtime as unknown as HostRuntimeKernel;
    if (kernel.externalAgents === undefined) throw new Error('Missing backend');
    vi.spyOn(kernel.externalAgents, 'observeNativeSession').mockResolvedValue({
      backendSessionId: 'native-exact-id', activity: 'running', title: 'Native continuity',
      replayEvents: [
        { type: 'agent', event: { type: 'message/start', messageId: 'snapshot', role: 'assistant' } },
        { type: 'agent', event: { type: 'message/text_delta', messageId: 'snapshot', delta: 'Native history' } },
        { type: 'agent', event: { type: 'message/end', messageId: 'snapshot' } },
      ],
    });
    const opened = await runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'fixture-cli', cols: 80, rows: 24 } });
    if (!opened.success) throw new Error(opened.error);
    const { sessionId, ptyId } = opened.data as AgentCliOpenData;
    await vi.waitFor(() => expect(pushes.some((push) => push.type === 'pty/output' && push.ptyId === ptyId && push.data.includes('READY'))).toBe(true));
    expect((await runtime.handleCommand({ type: 'pty/close', ptyId })).success).toBe(true);
    expect((await runtime.handleCommand({ type: 'agents/cli-snapshot', sessionId })).success).toBe(true);
    const reattached = await runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'fixture-cli', sessionId, cols: 80, rows: 24 } });
    expect(reattached.success && reattached.data).toMatchObject({ ptyId, initialOutput: expect.stringContaining('READY') });
    expect((await runtime.handleCommand({ type: 'pty/write', ptyId, data: 'still-alive\n' })).success).toBe(true);
    await vi.waitFor(() => expect(pushes.some((push) => push.type === 'pty/output' && push.ptyId === ptyId && push.data.includes('ACK:still-alive'))).toBe(true));
    expect(pushes.filter((push) => push.type === 'pty/exit')).toEqual([]);
  } finally {
    await runtime.dispose();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}, 15_000);
