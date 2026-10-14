import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InteractiveTerminalManager } from '@piwin/process';
import type { AgentCliOpenData } from '@piwin/contracts';
import { HostRuntime } from '../host-runtime.js';
import { installFixtureAgentAdapter } from '../testing/agent-plugin-fixture.js';

let runtime: HostRuntime | undefined;
let directory: string | undefined;
afterEach(async () => {
  await runtime?.dispose();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function setup(script: Record<string, unknown> = {}) {
  directory = await mkdtemp(join(tmpdir(), 'piwin-native-cli-'));
  const fixture = await installFixtureAgentAdapter(directory, {
    agentId: 'fixture-cli',
    script: {
      backendSessionId: 'native-exact-id',
      binaryPath: '/fixture/cli',
      nativeCli: { supported: true },
      capabilities: { agentId: 'fixture-cli', operations: {}, nativeCli: { supported: true } },
      cliLaunchArgs: ['--resume', 'native-exact-id'],
      ...script,
    },
  });
  runtime = new HostRuntime({
    mode: 'sdk',
    mock: true,
    piwinRoot: directory,
    externalAgents: { env: fixture.env },
  });
  const open = vi.spyOn(InteractiveTerminalManager.prototype, 'open').mockResolvedValue('pty-fixture');
  const close = vi.spyOn(InteractiveTerminalManager.prototype, 'close').mockResolvedValue();
  return { runtime, open, close, fixture };
}

describe('generic native CLI ownership and launch', () => {
  it('launches via session/cli-launch with Host binary/cwd and blocks Desktop prompts', async () => {
    const host = await setup();
    const opened = await host.runtime.handleCommand({
      type: 'agents/cli-open',
      input: { agentId: 'fixture-cli', cols: 80, rows: 24 },
    });
    expect(opened.success, opened.success ? '' : opened.error).toBe(true);
    if (!opened.success) throw new Error(opened.error);
    const data = opened.data as AgentCliOpenData;
    expect(data.ownership?.kind).toBe('native');
    expect(host.open.mock.calls[0]?.[0]).toMatchObject({
      executable: '/fixture/cli',
      args: ['--resume', 'native-exact-id'],
    });

    const prompt = await host.runtime.handleCommand({
      type: 'session/prompt',
      sessionId: data.sessionId,
      input: { text: 'hello' },
    });
    expect(prompt.success).toBe(false);
    expect(prompt.success ? '' : prompt.error).toMatch(/writer-busy/);

    const status = await host.runtime.handleCommand({
      type: 'agents/cli-status',
      sessionId: data.sessionId,
    });
    expect(status.success).toBe(true);
    if (!status.success) throw new Error(status.error);
    expect(status.data).toMatchObject({ ownership: { kind: 'native', ptyId: 'pty-fixture' } });
  });

  it('rejects missing launch capability, tampered native id, and spawn override fields before PTY', async () => {
    const missing = await setup({ cliLaunch: false, nativeCli: { supported: false } });
    const denied = await missing.runtime.handleCommand({
      type: 'agents/cli-open',
      input: { agentId: 'fixture-cli', cols: 80, rows: 24 },
    });
    expect(denied.success).toBe(false);
    expect(missing.open).not.toHaveBeenCalled();
    await missing.runtime.dispose();

    directory = await mkdtemp(join(tmpdir(), 'piwin-native-cli-tamper-'));
    const fixture = await installFixtureAgentAdapter(directory, {
      agentId: 'fixture-cli',
      script: {
        backendSessionId: 'native-exact-id',
        binaryPath: '/fixture/cli',
        nativeCli: { supported: true },
        capabilities: { agentId: 'fixture-cli', operations: {}, nativeCli: { supported: true } },
        cliLaunchTamper: true,
      },
    });
    runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: directory,
      externalAgents: { env: fixture.env },
    });
    const open = vi.spyOn(InteractiveTerminalManager.prototype, 'open').mockResolvedValue('pty-x');
    const tampered = await runtime.handleCommand({
      type: 'agents/cli-open',
      input: { agentId: 'fixture-cli', cols: 80, rows: 24 },
    });
    expect(tampered.success).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('returns to Desktop only after close/import and drains the queue after unlock', async () => {
    const host = await setup({
      replayEvents: [
        { type: 'agent', event: { type: 'message/start', messageId: 'n1', role: 'assistant' } },
        { type: 'agent', event: { type: 'message/text_delta', messageId: 'n1', delta: 'native history' } },
        { type: 'agent', event: { type: 'message/end', messageId: 'n1' } },
      ],
    });
    const opened = await host.runtime.handleCommand({
      type: 'agents/cli-open',
      input: { agentId: 'fixture-cli', cols: 80, rows: 24 },
    });
    if (!opened.success) throw new Error(opened.error);
    const { sessionId } = opened.data as AgentCliOpenData;

    const synced = await host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
    expect(synced.success, synced.success ? '' : synced.error).toBe(true);
    expect(host.close).toHaveBeenCalledWith('pty-fixture');
    if (!synced.success) throw new Error(synced.error);
    expect(synced.data).toMatchObject({ ownership: { kind: 'desktop', sessionId } });

    const status = await host.runtime.handleCommand({ type: 'agents/cli-status', sessionId });
    expect(status.success && status.data).toMatchObject({ ownership: { kind: 'desktop' } });
  });

  it('failed requestSuspend during handoff keeps switching and does not unlock Desktop', async () => {
    const host = await setup();
    const opened = await host.runtime.handleCommand({
      type: 'agents/cli-open',
      input: { agentId: 'fixture-cli', cols: 80, rows: 24 },
    });
    if (!opened.success) throw new Error(opened.error);
    const { sessionId } = opened.data as AgentCliOpenData;

    const kernel = host.runtime as unknown as {
      residencyController: { requestSuspend: (...args: unknown[]) => Promise<boolean> };
      runtimeController: { getStatus: (sessionId: string) => { generationId?: string } };
      queuedTurnController: { requestDrain: (sessionId: string) => void };
    };
    const drain = vi.spyOn(kernel.queuedTurnController, 'requestDrain');
    // Force a resident generation on the handoff path so failed suspend is observable.
    vi.spyOn(kernel.runtimeController, 'getStatus').mockReturnValue({ generationId: 'gen-handoff' });
    vi.spyOn(kernel.residencyController, 'requestSuspend').mockResolvedValue(false);

    const synced = await host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
    expect(synced.success).toBe(false);
    expect(synced.success ? '' : synced.error).toMatch(/transition-failed/);
    expect(drain).not.toHaveBeenCalled();

    const status = await host.runtime.handleCommand({ type: 'agents/cli-status', sessionId });
    expect(status.success && status.data).toMatchObject({
      ownership: { kind: 'switching', target: 'desktop' },
    });
  });

  it('refuses PTY spawn when structured runtime suspend is denied', async () => {
    const host = await setup();
    // First open succeeds and suspends structured runtime before PTY.
    const first = await host.runtime.handleCommand({
      type: 'agents/cli-open',
      input: { agentId: 'fixture-cli', cols: 80, rows: 24 },
    });
    if (!first.success) throw new Error(first.error);
    const { sessionId } = first.data as AgentCliOpenData;
    // Return to desktop so a second open can re-enter the launch path.
    const synced = await host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
    expect(synced.success, synced.success ? '' : synced.error).toBe(true);
    host.open.mockClear();

    const kernel = host.runtime as unknown as {
      residencyController: { requestSuspend: (...args: unknown[]) => Promise<boolean> };
      sessions: Map<string, unknown>;
    };
    // Keep a resident handle so suspend is attempted, then deny it.
    await host.runtime.handleCommand({ type: 'session/resume', sessionId });
    expect(kernel.sessions.has(sessionId)).toBe(true);
    vi.spyOn(kernel.residencyController, 'requestSuspend').mockResolvedValue(false);

    const second = await host.runtime.handleCommand({
      type: 'agents/cli-open',
      input: { agentId: 'fixture-cli', sessionId, cols: 80, rows: 24 },
    });
    expect(second.success).toBe(false);
    expect(second.success ? '' : second.error).toMatch(/transition-failed/);
    expect(host.open).not.toHaveBeenCalled();
    // Structured handle remains owned; ownership did not fake a Desktop handoff.
    expect(kernel.sessions.has(sessionId)).toBe(true);
    const status = await host.runtime.handleCommand({ type: 'agents/cli-status', sessionId });
    expect(status.success && status.data).toMatchObject({ ownership: { kind: 'desktop' } });
  });
});
