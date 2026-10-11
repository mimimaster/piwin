import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InteractiveTerminalManager } from '@piwin/process';
import type { AgentCliOpenData } from '@piwin/contracts';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { HostRuntime } from '../host-runtime.js';
import { installFixtureAgentAdapter } from '../testing/agent-plugin-fixture.js';

let runtime: HostRuntime | undefined;
let directory: string | undefined;
afterEach(async () => { await runtime?.dispose(); if (directory !== undefined) await rm(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function setup(catalog: unknown[] = []) {
  directory = await mkdtemp(join(tmpdir(), 'piwin-native-grok-'));
  const fixture = await installFixtureAgentAdapter(directory, { agentId: 'grok', script: {
    backendSessionId: 'native-grok-id', binaryPath: '/fixture/grok', catalog,
    replayEvents: [
      { type: 'agent', event: { type: 'message/start', messageId: 'cli-answer', role: 'assistant' } },
      { type: 'agent', event: { type: 'message/text_delta', messageId: 'cli-answer', delta: '来自原生 CLI 的回答' } },
      { type: 'agent', event: { type: 'message/end', messageId: 'cli-answer' } },
    ],
  } });
  runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: directory, externalAgents: { env: fixture.env } });
  const open = vi.spyOn(InteractiveTerminalManager.prototype, 'open').mockResolvedValue('pty-fixture');
  const close = vi.spyOn(InteractiveTerminalManager.prototype, 'close').mockResolvedValue();
  return { runtime, open, close };
}

describe('Host native Grok terminal routing', () => {
  it('creates one product binding, resumes the native id, and refreshes vendor history on return', async () => {
    const host = await setup();
    const first = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 } });
    if (!first.success) throw new Error(first.error);
    const opened = first.data as AgentCliOpenData;
    expect(opened).toEqual({ ptyId: 'pty-fixture', sessionId: expect.any(String) });
    expect(host.open.mock.calls[0]?.[0]).toMatchObject({ executable: '/fixture/grok', args: ['--fullscreen', '--cwd', expect.any(String), '--resume', 'native-grok-id'] });
    expect(opened.sessionId).not.toBe('native-grok-id');
    const second = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', sessionId: opened.sessionId, projectPath: '/ignored', cols: 100, rows: 30 } });
    expect(second.success).toBe(true);
    if (!second.success) throw new Error(second.error);
    expect(second.data).toEqual(opened);
    const synced = await host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId: opened.sessionId });
    expect(synced.success, synced.success ? '' : synced.error).toBe(true);
    expect(host.close).not.toHaveBeenCalled();
    const messages = await host.runtime.handleCommand({ type: 'session/messages', sessionId: opened.sessionId });
    if (!messages.success) throw new Error(messages.error);
    expect(messages.data).toMatchObject({ messages: [expect.objectContaining({ text: '来自原生 CLI 的回答' })] });
  });
  it('refuses Pi sessions and untrusted projects without opening a terminal', async () => {
    const host = await setup();
    const created = await host.runtime.handleCommand({ type: 'session/create', input: {} });
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const pi = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', sessionId, cols: 80, rows: 24 } });
    expect(pi.success).toBe(false);
    const untrusted = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', projectPath: directory ?? '', cols: 80, rows: 24 } });
    expect(untrusted.success).toBe(false);
    expect(host.open).not.toHaveBeenCalled();
  });
});

it('shares concurrent history refreshes without closing the retained terminal', async () => {
  const host = await setup();
  const opened = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 } });
  if (!opened.success) throw new Error(opened.error);
  const { sessionId } = opened.data as AgentCliOpenData;
  const kernel = host.runtime as unknown as Pick<HostRuntimeKernel, 'residencyController'>;
  const original = kernel.residencyController.requestSuspend.bind(kernel.residencyController);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const suspend = vi.spyOn(kernel.residencyController, 'requestSuspend').mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const first = host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
  await vi.waitFor(() => expect(suspend).toHaveBeenCalledOnce());
  const second = host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
  release?.();
  const results = await Promise.all([first, second]);
  expect(results.every((response) => response.success)).toBe(true);
  expect(suspend).toHaveBeenCalledOnce();
  expect(host.close).not.toHaveBeenCalled();
});

it('preserves a Host turn admitted while history refresh was reading the index', async () => {
  const host = await setup();
  const opened = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 } });
  if (!opened.success) throw new Error(opened.error);
  const { sessionId } = opened.data as AgentCliOpenData;
  const kernel = host.runtime as unknown as Pick<HostRuntimeKernel, 'residencyController' | 'runRegistry'>;
  const original = kernel.residencyController.requestSuspend.bind(kernel.residencyController);
  vi.spyOn(kernel.residencyController, 'requestSuspend').mockImplementationOnce(async (...args) => {
    kernel.runRegistry.createForegroundRun(sessionId, args[1]);
    return original(...args);
  });
  const synced = await host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
  expect(synced.success).toBe(true);
  expect(kernel.runRegistry.getForegroundRun(sessionId)?.status).toBe('running');
  expect(host.close).not.toHaveBeenCalled();
});
