import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPluginControlClient } from './agent-plugin-control.js';

const FIXTURE = `
import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const mode = process.env.PLUGIN_FIXTURE_MODE ?? 'normal';
const log = process.env.PLUGIN_FIXTURE_LOG;
const marker = process.env.PLUGIN_FIXTURE_CRASH_MARKER;
const lines = createInterface({ input: process.stdin });
const write = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
let checks = 0;
const ready = () => ({ agentId: 'grok', state: 'ready', binaryPath: '/fake/grok', version: '1.0.44', supportStatus: 'verified', checkedAt: new Date(checks * 1000).toISOString() });
const ok = (frame, result) => write({ protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: true, result });
const fail = (frame, code, message) => write({ protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: false, error: { code, message } });

lines.on('line', (line) => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  if (frame.kind !== 'request') return;
  const method = frame.method;
  if (method === 'plugin/initialize') return ok(frame, { agentId: frame.params.agentId, protocolVersion: 1 });
  if (method === 'check') {
    checks += 1;
    if (log) appendFileSync(log, 'check\\n');
    if (mode === 'crash-once' && marker && !existsSync(marker)) { writeFileSync(marker, '1'); process.exit(5); }
    if (mode === 'crash-on-check') process.exit(5);
    if (mode === 'malformed-status') return ok(frame, { agentId: 'grok', state: 'ready' });
    if (mode === 'state-flip' && checks > 1) {
      return ok(frame, { agentId: 'grok', state: 'unauthenticated', binaryPath: '/fake/grok', version: '1.0.44', supportStatus: 'verified', checkedAt: new Date().toISOString() });
    }
    if (mode === 'options-flip') {
      const changed = checks > 1;
      return ok(frame, { ...ready(), options: { agentId: 'grok',
        models: (changed ? ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5'] : ['grok-4.6', 'grok-4.5'])
          .map((id) => ({ id, label: id, contextTokens: changed ? 256000 : 500000 })),
        currentModelId: changed ? 'grok-4.7-build-fast' : 'grok-4.6',
        currentEffortId: 'high', modes: [], modeConfirmed: true, commands: [] } });
    }
    if (mode === 'defaults-flip') {
      const changed = checks > 1;
      return ok(frame, { ...ready(), options: { agentId: 'grok',
        models: [{ id: 'grok-4.7', label: 'Grok 4.7', efforts: ['high', 'low'] }],
        currentModelId: 'grok-4.7', currentEffortId: changed ? 'low' : 'high',
        modes: [], modeConfirmed: true, commands: [] }, permissionMode: changed ? 'default' : 'auto' });
    }
    return ok(frame, ready());
  }
  if (method === 'catalog/list') return ok(frame, [{ backendSessionId: 'b1', title: 'One' }]);
  if (method === 'catalog/rename' || method === 'catalog/delete' || method === 'plugin/dispose') return ok(frame, null);
  return fail(frame, 'unsupported', 'not served by fixture');
});
`;

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

async function harness(mode = 'normal') {
  const root = await mkdtemp(join(tmpdir(), 'piwin-plugin-control-'));
  const entrypoint = join(root, 'agent.mjs');
  const log = join(root, 'checks.log');
  const marker = join(root, 'crashed.marker');
  await writeFile(entrypoint, FIXTURE);
  const onStatusChanged = vi.fn();
  const client = AgentPluginControlClient.create({
    entrypoint,
    agentId: 'grok',
    pluginRevision: 'rev-1',
    runtime: { binaryPath: '/fake/grok' },
    onStatusChanged,
    env: {
      ...process.env,
      PLUGIN_FIXTURE_MODE: mode,
      PLUGIN_FIXTURE_LOG: log,
      PLUGIN_FIXTURE_CRASH_MARKER: marker,
    },
  });
  const checks = async (): Promise<number> => {
    try {
      return (await readFile(log, 'utf8')).split('\n').filter((line) => line === 'check').length;
    } catch {
      return 0;
    }
  };
  cleanups.push(async () => {
    await client.dispose().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  return { client, checks, onStatusChanged, entrypoint };
}

describe('Agent plugin control plane', () => {
  it('falls back to finalized turns when an older adapter does not support request usage', async () => {
    const { client } = await harness();
    await expect(
      client.listRequestUsage({ from: new Date().toISOString(), sessions: [] }),
    ).resolves.toEqual([]);
    await expect(client.listCatalog()).resolves.toHaveLength(1);
  });
  it('reports readiness and serves the vendor catalog', async () => {
    const { client } = await harness();
    await expect(client.getStatus()).resolves.toMatchObject({
      agentId: 'grok',
      state: 'ready',
      version: '1.0.44',
    });
    expect(await client.listCatalog()).toEqual([{ backendSessionId: 'b1', title: 'One' }]);
    await expect(client.renameCatalogSession('b1', 'Renamed')).resolves.toBeUndefined();
    await expect(client.deleteCatalogSession('b1')).resolves.toBeUndefined();
  });

  it('caches readiness within the TTL and re-hand-shakes on refresh', async () => {
    const { client, checks } = await harness();
    await client.getStatus();
    await client.getStatus();
    expect(await checks()).toBe(1);
    await client.getStatus(true);
    expect(await checks()).toBe(2);
  });

  it('invalidate forces the next check and collapses concurrent ones', async () => {
    const { client, checks } = await harness();
    await client.getStatus();
    client.invalidateStatus();
    expect(client.peekStatus()).toBeUndefined();
    await Promise.all([client.getStatus(), client.getStatus(), client.getStatus()]);
    expect(await checks()).toBe(2);
  });

  it('publishes a status change once per state transition', async () => {
    const { client, onStatusChanged } = await harness('state-flip');
    await client.getStatus();
    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    await client.getStatus(true);
    expect(onStatusChanged).toHaveBeenCalledTimes(2);
    expect(onStatusChanged.mock.calls[1]?.[0]).toMatchObject({ state: 'unauthenticated' });
  });

  it.each(['options-flip', 'defaults-flip'])(
    'publishes updated configuration while ready stays unchanged: %s',
    async (mode) => {
      const { client, onStatusChanged } = await harness(mode);
      await client.getStatus();
      const changed = await client.getStatus(true);
      expect(changed.state).toBe('ready');
      expect(onStatusChanged).toHaveBeenCalledTimes(2);
      expect(onStatusChanged.mock.calls[1]?.[0]).toEqual(changed);
      await client.getStatus(true);
      expect(onStatusChanged).toHaveBeenCalledTimes(2);
    },
  );

  it('does not publish a change for a new check timestamp alone', async () => {
    const { client, onStatusChanged } = await harness();
    const first = await client.getStatus();
    const second = await client.getStatus(true);
    expect(second.checkedAt).not.toBe(first.checkedAt);
    expect(onStatusChanged).toHaveBeenCalledTimes(1);
  });

  it('turns a malformed adapter status into unavailable instead of trusting it', async () => {
    const { client } = await harness('malformed-status');
    const status = await client.getStatus();
    expect(status).toMatchObject({ state: 'unavailable' });
    expect(status.state === 'unavailable' ? status.reason : '').toContain('invalid-status');
  });

  it('reports unavailable for a dead adapter and respawns on the next call', async () => {
    const { client, checks } = await harness('crash-once');
    const first = await client.getStatus();
    expect(first).toMatchObject({ state: 'unavailable' });
    expect(first.state === 'unavailable' ? first.reason : '').toContain('plugin-exited');
    await expect(client.getStatus(true)).resolves.toMatchObject({ state: 'ready' });
    expect(await checks()).toBe(2);
  });

  it('survives a permanently crashing adapter without hanging', async () => {
    const { client, checks } = await harness('crash-on-check');
    await expect(client.getStatus()).resolves.toMatchObject({ state: 'unavailable' });
    await expect(client.getStatus(true)).resolves.toMatchObject({ state: 'unavailable' });
    expect(await checks()).toBe(2);
  });

  it('stops serving after dispose', async () => {
    const { client } = await harness();
    await client.getStatus();
    await client.dispose();
    await expect(client.listCatalog()).rejects.toMatchObject({ code: 'plugin-closed' });
  });
});
