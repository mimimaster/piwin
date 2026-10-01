import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentPluginEmission, AgentPluginPermissionPrompt, AgentPluginSessionScope } from '@piwin/contracts';
import { AgentPluginBridge, AgentPluginBridgeError } from './agent-plugin-bridge.js';

/**
 * Minimal fixture adapter: speaks only the Host frame protocol. It imports
 * nothing from the workspace so it proves the bridge needs no vendor code.
 */
const FIXTURE = `
import { createInterface } from 'node:readline';
const mode = process.env.PLUGIN_FIXTURE_MODE ?? 'normal';
const lines = createInterface({ input: process.stdin });
const write = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
let promptFrame;
let callbackResult;
const ok = (frame, result) => write({ protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: true, result });
const fail = (frame, code, message) => write({ protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: false, error: { code, message } });

lines.on('line', (line) => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  if (frame.kind === 'response') {
    if (frame.method === 'permission/request' || frame.method === 'intervention/event') callbackResult = frame;
    if (promptFrame) {
      ok(promptFrame, { status: 'completed', stopReason: 'stop' });
      promptFrame = undefined;
    }
    return;
  }
  const method = frame.method;
  if (method === 'plugin/initialize') return ok(frame, { agentId: frame.params.agentId, protocolVersion: 1 });
  if (method === 'check') return ok(frame, { agentId: 'grok', state: 'ready', binaryPath: '/fake/grok', version: '1.0.44', supportStatus: 'verified', checkedAt: new Date().toISOString() });
  if (method === 'catalog/list') return ok(frame, [{ backendSessionId: 'b1', title: 'One' }]);
  if (method === 'session/new') {
    if (mode === 'crash-on-new') process.exit(3);
    if (mode === 'malformed') { process.stdout.write('not json\\n'); return; }
    if (mode === 'foreign-scope') {
      write({ protocolVersion: 1, kind: 'event', scope: { kind: 'session', sessionId: 'other', runtimeGenerationId: 'gen-1' }, emission: { type: 'title', title: 'Foreign' } });
    }
    write({ protocolVersion: 1, kind: 'event', scope: frame.scope, emission: { type: 'title', title: 'New' } });
    write({ protocolVersion: 1, kind: 'event', scope: frame.scope, emission: { type: 'agent', event: { kind: 'text', text: 'hi' }, media: [{ directoryId: 'images', relativePath: 'a/b.png', kind: 'image', importKey: 'k1' }] } });
    if (mode === 'late-event') {
      write({ protocolVersion: 1, kind: 'event', scope: frame.scope, emission: { type: 'agent', event: { kind: 'text', text: 'late' } } });
    }
    return ok(frame, { backendSessionId: 'b1', agentVersion: '1.0.44', capabilities: { kind: 'external-agent' }, options: { models: [], efforts: [], modes: [], commands: [] }, replayEvents: [] });
  }
  if (method === 'session/prompt') {
    if (mode === 'exit-on-prompt') process.exit(7);
    promptFrame = frame;
    write({ protocolVersion: 1, kind: 'request', scope: frame.scope, requestId: 'perm-1', method: 'permission/request', params: { action: 'file-write', detail: 'write a file', context: {}, options: [{ id: 'allow' }, { id: 'deny' }], runId: frame.params.runId } });
    return;
  }
  if (method === 'session/callback-result') return ok(frame, callbackResult ?? null);
  if (method === 'session/mcp-status') {
    if (mode === 'hang') return;
    return ok(frame, { servers: [], observed: false });
  }
  if (method === 'plugin/dispose') return ok(frame, null);
  return fail(frame, 'unsupported', 'not served by fixture');
});
`;

const SCOPE: AgentPluginSessionScope = { sessionId: 's1', runtimeGenerationId: 'gen-1' };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

async function harness(mode = 'normal', overrides: Partial<Parameters<typeof AgentPluginBridge.start>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'piwin-plugin-bridge-'));
  const entrypoint = join(root, 'agent.mjs');
  await writeFile(entrypoint, FIXTURE);
  const emissions: Array<{ emission: AgentPluginEmission; scope: AgentPluginSessionScope }> = [];
  const permission = vi.fn(async (prompt: AgentPluginPermissionPrompt) => ({ optionId: prompt.options[0]?.optionId ?? 'allow' }));
  const closed: string[] = [];
  const bridge = AgentPluginBridge.start({
    entrypoint, agentId: 'grok', pluginRevision: 'rev-1', runtime: {},
    resolveSessionScope: (scope) => scope.sessionId === SCOPE.sessionId && scope.runtimeGenerationId === SCOPE.runtimeGenerationId,
    onSessionEmission: (emission, scope) => emissions.push({ emission, scope }),
    callbacks: { requestPermission: permission, interventionEvent: async () => ({ accepted: false }) },
    onClosed: (reason) => closed.push(reason),
    env: { ...process.env, PLUGIN_FIXTURE_MODE: mode },
    ...overrides,
  });
  cleanups.push(async () => { await bridge.dispose().catch(() => undefined); await rm(root, { recursive: true, force: true }); });
  return { bridge, emissions, permission, closed, entrypoint, root };
}

describe('Host-side Agent plugin bridge', () => {
  it('spawns the installed adapter and round-trips plugin-scope requests', async () => {
    const { bridge } = await harness();
    await bridge.initialize();
    const status = await bridge.request('check', { refresh: true });
    expect(status).toMatchObject({ agentId: 'grok', state: 'ready' });
    expect(await bridge.request('catalog/list', {})).toEqual([{ backendSessionId: 'b1', title: 'One' }]);
  });

  it('opens a session and delivers ordered emissions with validated media proposals', async () => {
    const { bridge, emissions } = await harness();
    await bridge.initialize();
    const opened = await bridge.request('session/new', { cwd: '/tmp', binding: { agentId: 'grok', backendSessionId: 'b1' } as never }, { kind: 'session', ...SCOPE });
    expect(opened.backendSessionId).toBe('b1');
    expect(emissions.map((entry) => entry.emission.type)).toEqual(['title', 'agent']);
    const media = emissions[1]?.emission;
    expect(media !== undefined && media.type === 'agent' ? media.media : undefined).toEqual([
      { directoryId: 'images', relativePath: 'a/b.png', kind: 'image', importKey: 'k1' },
    ]);
  });

  it('answers a plugin permission callback and resolves the prompt once', async () => {
    const { bridge, permission, emissions } = await harness();
    await bridge.initialize();
    const outcome = await bridge.prompt(SCOPE, { input: { text: 'hello' }, runId: 'run-1' });
    expect(outcome).toEqual({ status: 'completed', stopReason: 'stop' });
    expect(permission).toHaveBeenCalledTimes(1);
    const prompt = permission.mock.calls[0]?.[0];
    expect(prompt?.action).toBe('file-write');
    expect(() => emissions).not.toThrow();
  });

  it('drops emissions from a foreign session or generation', async () => {
    const { bridge, emissions } = await harness('foreign-scope');
    await bridge.initialize();
    await bridge.request('session/new', { cwd: '/tmp', binding: {} as never }, { kind: 'session', ...SCOPE });
    expect(emissions.map((entry) => entry.emission.type)).toEqual(['title', 'agent']);
  });

  it('drops late emissions once the owner marks the bridge disposed', async () => {
    const { bridge, emissions } = await harness('late-event');
    await bridge.initialize();
    bridge.markDisposed();
    await bridge.request('session/new', { cwd: '/tmp', binding: {} as never }, { kind: 'session', ...SCOPE });
    expect(emissions).toEqual([]);
  });

  it('terminalizes a crashed plugin exactly once and rejects in-flight calls', async () => {
    const { bridge, closed } = await harness('exit-on-prompt');
    await bridge.initialize();
    await expect(bridge.prompt(SCOPE, { input: { text: 'x' }, runId: 'run-1' })).rejects.toThrow('plugin-exited');
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    expect(closed[0]).toContain('plugin-exited');
    await expect(bridge.request('check', { refresh: true })).rejects.toThrow(AgentPluginBridgeError);
  });

  it('closes on a malformed frame instead of trusting the peer', async () => {
    const { bridge, closed } = await harness('malformed');
    await bridge.initialize();
    await bridge.request('session/new', { cwd: '/tmp', binding: {} as never }, { kind: 'session', ...SCOPE }).catch(() => undefined);
    await vi.waitFor(() => expect(closed).toHaveLength(1));
  });

  it('stops accepting work after dispose', async () => {
    const { bridge } = await harness();
    await bridge.initialize();
    await bridge.dispose();
    await expect(bridge.request('check', { refresh: true })).rejects.toMatchObject({ code: 'plugin-closed' });
  });

  it('bounds a request that the plugin never answers', async () => {
    const { bridge } = await harness('hang', { requestTimeoutMs: 50 });
    await bridge.initialize();
    await expect(bridge.request('session/mcp-status', {}, { kind: 'session', ...SCOPE })).rejects.toThrow('timed out');
  });
});
