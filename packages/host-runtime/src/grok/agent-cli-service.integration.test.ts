import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InteractiveTerminalManager } from '@piwin/process';
import { createExtensionRevisionStore } from '@piwin/extensions';
import type { AgentCliOpenData } from '@piwin/contracts';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { HostRuntime } from '../host-runtime.js';
import { AgentPluginBridge } from '../agent-plugin-bridge.js';
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
  return { runtime, open, close, fixture };
}

describe('Host native Grok terminal routing', () => {
  it('performs one readiness handshake on cold open and reuses it on the next new session', async () => {
    const host = await setup();
    const request = vi.spyOn(AgentPluginBridge.prototype, 'request');
    const open = () => host.runtime.handleCommand({
      type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 },
    });

    const first = await open();
    expect(first.success, first.success ? '' : first.error).toBe(true);
    expect(request.mock.calls.filter(([method]) => method === 'check')).toHaveLength(1);
    request.mockClear();

    const second = await open();
    expect(second.success, second.success ? '' : second.error).toBe(true);
    expect(request.mock.calls.filter(([method]) => method === 'check')).toHaveLength(0);
  });

  it('rechecks extension enablement after activation even when readiness is cached', async () => {
    const host = await setup();
    const kernel = host.runtime as unknown as Pick<HostRuntimeKernel, 'activateSessionRuntime'>;
    const activate = kernel.activateSessionRuntime.bind(kernel);
    vi.spyOn(kernel, 'activateSessionRuntime').mockImplementationOnce(async (sessionId) => {
      const handle = await activate(sessionId);
      await createExtensionRevisionStore(directory ?? '').setEnabled(host.fixture.extensionId, false);
      return handle;
    });

    const response = await host.runtime.handleCommand({
      type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 },
    });
    expect(response.success).toBe(false);
    expect(response.success ? '' : response.error).toContain('agent-plugin-disabled');
    expect(host.open).not.toHaveBeenCalled();
  });

  it('creates one product binding, resumes the native id, and refreshes vendor history on return', async () => {
    const host = await setup();
    const first = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 } });
    if (!first.success) throw new Error(first.error);
    const opened = first.data as AgentCliOpenData;
    expect(opened).toMatchObject({ ptyId: 'pty-fixture', sessionId: expect.any(String), ownership: { kind: 'native', ptyId: 'pty-fixture' } });
    expect(host.open.mock.calls[0]?.[0]).toMatchObject({ executable: '/fixture/grok', args: ['--fullscreen', '--cwd', expect.any(String), '--resume', 'native-grok-id'] });
    expect(opened.sessionId).not.toBe('native-grok-id');
    const second = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', sessionId: opened.sessionId, projectPath: '/ignored', cols: 100, rows: 30 } });
    expect(second.success).toBe(true);
    if (!second.success) throw new Error(second.error);
    expect(second.data).toMatchObject({ ptyId: opened.ptyId, sessionId: opened.sessionId });
    const synced = await host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId: opened.sessionId });
    expect(synced.success, synced.success ? '' : synced.error).toBe(true);
    // Handoff closes the owned native PTY, then imports history on the exact native id.
    expect(host.close).toHaveBeenCalledWith('pty-fixture');
    if (!synced.success) throw new Error(synced.error);
    expect(synced.data).toMatchObject({ ownership: { kind: 'desktop', sessionId: opened.sessionId } });
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

it('dedupes concurrent handoff syncs and closes the owned terminal once', async () => {
  const host = await setup();
  const opened = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 } });
  if (!opened.success) throw new Error(opened.error);
  const { sessionId } = opened.data as AgentCliOpenData;
  let releaseClose: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseClose = resolve; });
  host.close.mockImplementation(async () => { await gate; });
  const first = host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
  await vi.waitFor(() => expect(host.close).toHaveBeenCalledOnce());
  const second = host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
  releaseClose?.();
  const results = await Promise.all([first, second]);
  expect(results.every((response) => response.success)).toBe(true);
  expect(host.close).toHaveBeenCalledOnce();
});

it('skips history reload when a Desktop turn is already foreground during handoff import', async () => {
  const host = await setup();
  const opened = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 } });
  if (!opened.success) throw new Error(opened.error);
  const { sessionId } = opened.data as AgentCliOpenData;
  const kernel = host.runtime as unknown as Pick<HostRuntimeKernel, 'runRegistry'>;
  // A Desktop Run that won the writer race before import must not be cancelled by cli-sync.
  kernel.runRegistry.createForegroundRun(sessionId, 'gen-desktop');
  const synced = await host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
  expect(synced.success).toBe(true);
  expect(host.close).toHaveBeenCalledWith('pty-fixture');
  expect(kernel.runRegistry.getForegroundRun(sessionId)?.status).toBe('running');
});

it('marks an imported session whose history was never replayed, until it is synced', async () => {
  const host = await setup([{ backendSessionId: 'native-grok-id', title: 'Vendor session', cwd: '/tmp/vendor', lastChangeUnixMs: 1 }]);
  let sessionId = '';
  host.runtime.attachPushSink({ id: 'imported-session', push: (push) => {
    if (push.type === 'session/index-updated' && push.op === 'created') sessionId = push.sessionId;
  } });
  const imported = await host.runtime.handleCommand({ type: 'agents/sessions-sync', agentId: 'grok' });
  expect(imported.success, imported.success ? '' : imported.error).toBe(true);
  const resume = async () => {
    const response = await host.runtime.handleCommand({ type: 'session/resume', sessionId });
    if (!response.success) throw new Error(response.error);
    return response.data as { messages: unknown[]; nativeHistory?: string };
  };
  // Without the mark a client paints this conversation as an empty new one.
  expect(await resume()).toMatchObject({ messages: [], nativeHistory: 'unsynced' });
  const synced = await host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId });
  expect(synced.success, synced.success ? '' : synced.error).toBe(true);
  const after = await resume();
  expect(after.nativeHistory).toBeUndefined();
  expect(after.messages).toEqual([expect.objectContaining({ text: '来自原生 CLI 的回答' })]);
});

it('falls back to the incremental refresh when the extension cannot snapshot native history', async () => {
  // The fixture adapter does not advertise nativeObservation, like older extensions.
  const host = await setup([{ backendSessionId: 'native-grok-id', title: 'Vendor session', cwd: '/tmp/vendor', lastChangeUnixMs: 1 }]);
  let sessionId = '';
  host.runtime.attachPushSink({ id: 'legacy-snapshot', push: (push) => {
    if (push.type === 'session/index-updated' && push.op === 'created') sessionId = push.sessionId;
  } });
  const imported = await host.runtime.handleCommand({ type: 'agents/sessions-sync', agentId: 'grok' });
  expect(imported.success, imported.success ? '' : imported.error).toBe(true);
  const snapshot = await host.runtime.handleCommand({ type: 'agents/cli-snapshot', sessionId });
  expect(snapshot.success, snapshot.success ? '' : snapshot.error).toBe(true);
  const messages = await host.runtime.handleCommand({ type: 'session/messages', sessionId });
  if (!messages.success) throw new Error(messages.error);
  expect(messages.data).toMatchObject({ messages: [expect.objectContaining({ text: '来自原生 CLI 的回答' })] });
});

it('leaves a running native CLI alone when snapshots are unsupported', async () => {
  const host = await setup();
  const opened = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 } });
  if (!opened.success) throw new Error(opened.error);
  const { sessionId } = opened.data as AgentCliOpenData;
  const snapshot = await host.runtime.handleCommand({ type: 'agents/cli-snapshot', sessionId });
  expect(snapshot.success, snapshot.success ? '' : snapshot.error).toBe(true);
  expect(host.close).not.toHaveBeenCalled();
  expect(snapshot.success && snapshot.data).toMatchObject({ ownership: { kind: 'native' } });
});
