import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentCliOpenData, HostPush, SessionListData } from '@piwin/contracts';
import { InteractiveTerminalManager } from '@piwin/process';
import { getSessionRecord, updateSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { HostRuntime } from '../host-runtime.js';
import { getPiwinSessionIndexPath } from '../paths.js';
import { installFixtureAgentAdapter } from '../testing/agent-plugin-fixture.js';

let runtime: HostRuntime | undefined;
let directory: string | undefined;
afterEach(async () => {
  await runtime?.dispose();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  vi.restoreAllMocks();
});

async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'piwin-native-catalog-'));
  const fixture = await installFixtureAgentAdapter(directory, {
    agentId: 'grok', script: { backendSessionId: 'native-grok-id', binaryPath: '/fixture/grok' },
  });
  runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: directory, externalAgents: { env: fixture.env } });
  vi.spyOn(InteractiveTerminalManager.prototype, 'open').mockResolvedValue('pty-fixture');
  vi.spyOn(InteractiveTerminalManager.prototype, 'close').mockResolvedValue();
  const kernel = runtime as unknown as HostRuntimeKernel;
  if (kernel.externalAgents === undefined) throw new Error('Missing fixture backend');
  const catalog = vi.spyOn(kernel.externalAgents, 'listCatalog').mockResolvedValue([]);
  const pushes: HostPush[] = [];
  runtime.attachPushSink({ id: 'native-catalog', push: (push) => pushes.push(push) });
  const response = await runtime.handleCommand({
    type: 'agents/cli-open', input: { agentId: 'grok', cols: 80, rows: 24 },
  });
  if (!response.success) throw new Error(response.error);
  const { sessionId } = response.data as AgentCliOpenData;
  return { runtime, catalog, pushes, sessionId, indexPath: getPiwinSessionIndexPath(directory) };
}

it('lists a native Grok conversation when its title appears after opening, without a Desktop return', async () => {
  const host = await setup();
  const before = await getSessionRecord(host.indexPath, host.sessionId);
  if (before === undefined) throw new Error('Missing product session');
  const listed = async () => {
    const response = await host.runtime.handleCommand({ type: 'session/list', ...(before.scope === undefined ? {} : { scope: before.scope }) });
    if (!response.success) throw new Error(response.error);
    return response.data as SessionListData;
  };
  expect((await listed()).sessions).toEqual([]);
  host.catalog.mockResolvedValue([{
    backendSessionId: 'native-grok-id', title: 'Repair sidebar sessions',
    lastChangeUnixMs: Date.now() + 10_000,
  }]);
  await vi.waitFor(() => {
    expect(host.pushes).toContainEqual(expect.objectContaining({
      type: 'session/index-updated', sessionId: host.sessionId,
      session: expect.objectContaining({ name: 'Repair sidebar sessions', backend: expect.objectContaining({ agentId: 'grok' }) }),
    }));
  }, { timeout: 5_000 });
  expect((await listed()).sessions).toEqual([expect.objectContaining({ id: host.sessionId, name: 'Repair sidebar sessions' })]);
  const status = await host.runtime.handleCommand({ type: 'agents/cli-status', sessionId: host.sessionId });
  expect(status.success && status.data).toMatchObject({ ownership: { kind: 'native' } });
  const updates = host.pushes.filter((push) => push.type === 'session/index-updated' && push.op === 'updated').length;
  const calls = host.catalog.mock.calls.length;
  await vi.waitFor(() => expect(host.catalog.mock.calls.length).toBeGreaterThan(calls), { timeout: 5_000 });
  expect(host.pushes.filter((push) => push.type === 'session/index-updated' && push.op === 'updated')).toHaveLength(updates);
}, 15_000);

it('preserves local metadata and never reconciles unrelated or temporarily missing native sessions', async () => {
  const host = await setup();
  const pinnedAt = '2026-10-12T00:00:00.000Z';
  await updateSessionRecord(host.indexPath, host.sessionId, (record) => {
    record.name = 'My title'; record.nameSource = 'user'; record.isPinned = true;
    record.pinnedAt = pinnedAt; record.isArchived = true;
  });
  host.catalog.mockResolvedValue([{
    backendSessionId: 'native-grok-id', title: 'Vendor title', lastChangeUnixMs: Date.now() + 10_000,
  }, { backendSessionId: 'unrelated', title: 'Unrelated' }]);
  await vi.waitFor(() => expect(host.pushes).toContainEqual(expect.objectContaining({
    type: 'session/index-updated', op: 'updated', sessionId: host.sessionId,
    session: expect.objectContaining({ name: 'My title', isPinned: true, isArchived: true }),
  })), { timeout: 5_000 });
  host.catalog.mockResolvedValue([]);
  const calls = host.catalog.mock.calls.length;
  await vi.waitFor(() => expect(host.catalog.mock.calls.length).toBeGreaterThan(calls), { timeout: 5_000 });
  expect(await getSessionRecord(host.indexPath, host.sessionId)).toMatchObject({
    name: 'My title', nameSource: 'user', isPinned: true, pinnedAt, isArchived: true,
  });
  expect(host.pushes.filter((push) => push.type === 'session/index-updated' && push.op === 'created')).toHaveLength(1);
}, 15_000);

it('detaches views and snapshots a running native turn without closing or activating an agent session', async () => {
  const host = await setup();
  const kernel = host.runtime as unknown as HostRuntimeKernel;
  if (kernel.externalAgents === undefined) throw new Error('Missing backend');
  const observe = vi.spyOn(kernel.externalAgents, 'observeNativeSession').mockResolvedValue({
    backendSessionId: 'native-grok-id', activity: 'running', title: 'Native work', lastChangeUnixMs: 1000,
    replayEvents: [
      { type: 'agent', event: { type: 'message/start', messageId: 'native-user', role: 'user' } },
      { type: 'agent', event: { type: 'message/text_delta', messageId: 'native-user', delta: 'Continue working' } },
      { type: 'agent', event: { type: 'message/end', messageId: 'native-user' } },
    ],
  });
  await vi.waitFor(() => expect(host.pushes).toContainEqual(expect.objectContaining({
    type: 'agents/cli-ownership', ownership: expect.objectContaining({ kind: 'native', activity: 'running' }),
  })), { timeout: 5_000 });
  const close = vi.mocked(InteractiveTerminalManager.prototype.close);
  const activate = vi.spyOn(kernel, 'activateSessionRuntime');
  const detached = await host.runtime.handleCommand({ type: 'pty/close', ptyId: 'pty-fixture' });
  expect(detached.success).toBe(true);
  const synced = await host.runtime.handleCommand({ type: 'agents/cli-sync', sessionId: host.sessionId, preserveNative: true });
  expect(synced.success, synced.success ? '' : synced.error).toBe(true);
  expect(synced.success && synced.data).toMatchObject({ ownership: { kind: 'native', activity: 'running' } });
  expect(observe).toHaveBeenCalledWith('grok', expect.objectContaining({ includeHistory: true, backendSessionId: 'native-grok-id' }), host.sessionId);
  expect(close).not.toHaveBeenCalled();
  expect(activate).not.toHaveBeenCalled();
  expect((await getSessionRecord(host.indexPath, host.sessionId))?.backend?.syncedChangeUnixMs).toBe(1000);
  const reattached = await host.runtime.handleCommand({ type: 'agents/cli-open', input: { agentId: 'grok', sessionId: host.sessionId, cols: 80, rows: 24 } });
  expect(reattached.success && reattached.data).toMatchObject({ ptyId: 'pty-fixture' });
  expect(InteractiveTerminalManager.prototype.open).toHaveBeenCalledOnce();
  const messages = await host.runtime.handleCommand({ type: 'session/messages', sessionId: host.sessionId });
  expect(messages.success && messages.data).toMatchObject({ messages: [expect.objectContaining({ text: 'Continue working' })] });
}, 15_000);

it('takes an idle native writer on a Desktop send, but refuses to interrupt a running turn', async () => {
  const host = await setup();
  const kernel = host.runtime as unknown as HostRuntimeKernel;
  if (kernel.externalAgents === undefined) throw new Error('Missing backend');
  const observe = vi.spyOn(kernel.externalAgents, 'observeNativeSession').mockResolvedValue({ backendSessionId: 'native-grok-id', activity: 'running' });
  const running = await host.runtime.handleCommand({ type: 'session/prompt', sessionId: host.sessionId, input: { text: 'Desktop while native is active' } });
  expect(running.success).toBe(false);
  expect(InteractiveTerminalManager.prototype.close).not.toHaveBeenCalled();
  observe.mockResolvedValue({ backendSessionId: 'native-grok-id', activity: 'idle' });
  const idle = await host.runtime.handleCommand({ type: 'session/prompt', sessionId: host.sessionId, input: { text: 'Continue from Desktop' } });
  expect(idle.success, idle.success ? '' : idle.error).toBe(true);
  expect(InteractiveTerminalManager.prototype.close).toHaveBeenCalledWith('pty-fixture');
  await vi.waitFor(() => expect(host.pushes.some((push) => push.type === 'run/updated' && push.run.sessionId === host.sessionId && push.run.status === 'completed')).toBe(true));
  const status = await host.runtime.handleCommand({ type: 'agents/cli-status', sessionId: host.sessionId });
  expect(status.success && status.data).toMatchObject({ ownership: { kind: 'desktop' } });
}, 15_000);

it('does not read or replace a Host-controlled active turn when a view requests a snapshot', async () => {
  const host = await setup();
  const kernel = host.runtime as unknown as HostRuntimeKernel;
  if (kernel.externalAgents === undefined) throw new Error('Missing backend');
  const observe = vi.spyOn(kernel.externalAgents, 'observeNativeSession');
  const run = kernel.runRegistry.createForegroundRun(host.sessionId, 'existing-generation');
  const snapshot = await host.runtime.handleCommand({ type: 'agents/cli-snapshot', sessionId: host.sessionId });
  expect(snapshot.success).toBe(true);
  expect(observe).not.toHaveBeenCalled();
  expect(kernel.runRegistry.getForegroundRun(host.sessionId)?.runId).toBe(run.runId);
  expect(InteractiveTerminalManager.prototype.close).not.toHaveBeenCalled();
});
