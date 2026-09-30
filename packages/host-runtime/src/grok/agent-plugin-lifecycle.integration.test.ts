import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GROK_PLUGIN_MANIFEST } from '@piwin/agent-plugins';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeGrokAgent } from '@piwin/acp-agent/testing';
import type { HostPush, HostResponse } from '@piwin/contracts';
import { HostRuntime } from '../host-runtime.js';
import { createAgentPluginInventory } from './agent-plugin-inventory.js';

function data(response: HostResponse): unknown {
  if (!response.success) throw new Error(response.error);
  return response.data;
}
function failure(response: HostResponse): string {
  if (response.success) throw new Error('expected failed response');
  return response.error;
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });

async function harness(root?: string) {
  const rootDir = root ?? await mkdtemp(join(tmpdir(), 'piwin-agent-install-'));
  const agent = createFakeGrokAgent({ turns: [[{ kind: 'text', text: 'retained history' }]] });
  const detect = vi.fn(async () => ({ agentId: 'grok', state: 'ready' as const, binaryPath: '/fake/grok', version: '1.0.44', supportStatus: 'verified' as const, checkedAt: new Date().toISOString() }));
  const transport = vi.fn(() => agent.createTransport());
  const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir, grok: { detect, createTransport: transport, testPlatform: 'darwin' } });
  const pushes: HostPush[] = [];
  runtime.attachPushSink({ id: 'inventory-test', push: (message) => pushes.push(message) });
  cleanups.push(async () => { await runtime.dispose(); if (root === undefined) await rm(rootDir, { recursive: true, force: true }); });
  return { rootDir, runtime, detect, transport, pushes };
}

const install = { type: 'agents/install' as const, source: { kind: 'bundled' as const, agentId: 'grok' as const } };

describe('Host-owned Agent plugin lifecycle', () => {
  it('listing or installing an adapter never starts the third-party CLI', async () => {
    const { runtime, detect, transport } = await harness();
    expect(data(await runtime.handleCommand({ type: 'agents/list' }))).toEqual({ plugins: [] });
    expect(data(await runtime.handleCommand({ type: 'agents/status' }))).toEqual({ agents: [] });
    expect((await runtime.handleCommand(install)).success).toBe(true);
    expect(detect).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect((await runtime.handleCommand({ type: 'agents/status', refresh: true })).success).toBe(true);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('disabling blocks new Runs even with a resident handle; uninstall keeps history and dependencies', async () => {
    const { runtime, rootDir, pushes } = await harness();
    await runtime.handleCommand(install);
    const created = await runtime.handleCommand({ type: 'session/create', input: { agentId: 'grok', projectPath: '/tmp/grok-project' } });
    expect(created.success).toBe(true);
    const { sessionId } = data(created) as { sessionId: string };
    const prompt = await runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'hello' } });
    expect(prompt.success).toBe(true);
    await vi.waitFor(() => expect(pushes.some((message) => message.type === 'run/updated' && message.run.sessionId === sessionId && message.run.status === 'completed')).toBe(true));
    expect((await runtime.handleCommand({ type: 'agents/set-enabled', agentId: 'grok', enabled: false })).success).toBe(true);
    const blocked = await runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'must not run' } });
    expect(blocked.success).toBe(false);
    expect(failure(blocked)).toContain('agent-plugin-disabled');
    const userBinary = join(rootDir, 'user-owned-grok');
    await writeFile(userBinary, 'user-owned');
    const removed = await runtime.handleCommand({ type: 'agents/uninstall', agentId: 'grok' });
    expect(data(removed)).toMatchObject({ removed: true, historyPreserved: true, runtimePreserved: true });
    expect(await readFile(userBinary, 'utf8')).toBe('user-owned');
    const history = await runtime.handleCommand({ type: 'session/resume', sessionId });
    expect(history.success).toBe(true);
    const stillBlocked = await runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'must not run either' } });
    expect(failure(stillBlocked)).toContain('agent-plugin-not-installed');
    await runtime.handleCommand(install);
    expect((await runtime.handleCommand({ type: 'agents/set-enabled', agentId: 'grok', enabled: true })).success).toBe(true);
  });

  it('serialized stores preserve concurrent mutations and survive reopening', async () => {
    const { rootDir, runtime } = await harness();
    await runtime.handleCommand(install);
    const first = createAgentPluginInventory(rootDir);
    const second = createAgentPluginInventory(rootDir);
    await Promise.all([first.selectRuntime('grok', '/tmp/my-grok'), second.setEnabled('grok', false)]);
    expect(await createAgentPluginInventory(rootDir).get('grok')).toMatchObject({ enabled: false, runtime: { binaryPath: '/tmp/my-grok', ownership: 'user' } });
  });

  it('rejects wrong digest and version pins without changing inventory', async () => {
    const { runtime } = await harness();
    const body = JSON.stringify(GROK_PLUGIN_MANIFEST);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body));
    const source = { kind: 'registry' as const, agentId: 'grok', version: '1.0.0', url: 'https://extension.piwinwin.com/agents/grok-1.0.0.json', sha256: 'a'.repeat(64) };
    const badDigest = await runtime.handleCommand({ type: 'agents/install', source });
    expect(failure(badDigest)).toContain('digest-mismatch');
    const badVersion = await runtime.handleCommand({ type: 'agents/install', source: { ...source, sha256: createHash('sha256').update(body).digest('hex'), version: '9.9.9' } });
    expect(failure(badVersion)).toContain('version-mismatch');
    expect(data(await runtime.handleCommand({ type: 'agents/list' }))).toEqual({ plugins: [] });
  });

  it('fails closed for unreviewed remote manifest sources', async () => {
    const { runtime } = await harness();
    const response = await runtime.handleCommand({ type: 'agents/install', source: { kind: 'registry', agentId: 'grok', version: '1.0.0', url: 'https://example.com/adapter.json', sha256: 'a'.repeat(64) } });
    expect(failure(response)).toContain('source-unreviewed');
    expect(data(await runtime.handleCommand({ type: 'agents/list' }))).toEqual({ plugins: [] });
  });
});
