/**
 * Session-backend extension lifecycle (ADR 0082).
 *
 * The extension registry is the only install authority. The retired `agents/*`
 * inventory commands answer with migration guidance and must not install,
 * enable, or remove a backend on their own.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSummary, HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import { createExtensionRevisionStore, installExtension } from '@piwin/extensions';
import { HostRuntime } from '../host-runtime.js';
import { installFixtureAgentAdapter } from '../testing/agent-plugin-fixture.js';
import { listExtensionBackends } from '../extension-session-backends.js';

function data(response: HostResponse): unknown {
  if (!response.success) throw new Error(`${response.command}: ${response.error}`);
  return response.data;
}
function failure(response: HostResponse): string {
  if (response.success) throw new Error('expected failed response');
  return response.error;
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

async function harness(script: unknown = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-agent-install-'));
  const installed = await installFixtureAgentAdapter(rootDir, { script });
  const runtime = new HostRuntime({
    mode: 'sdk', mock: true, piwinRoot: rootDir,
    externalAgents: { env: installed.env },
  });
  const pushes: HostPush[] = [];
  runtime.attachPushSink({ id: 'inventory-test', push: (message) => pushes.push(message) });
  cleanups.push(async () => {
    await runtime.dispose();
    // Plugin child teardown can briefly hold package files open on Linux CI.
    await rm(rootDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
  });
  return { rootDir, runtime, pushes, agentId: installed.agentId, extensionId: installed.extensionId };
}

describe('Session backend extension lifecycle', () => {
  it('detects an enabled backend on the first status query without a manual refresh', async () => {
    const { runtime, pushes, agentId, extensionId } = await harness();
    const listed = data(await runtime.handleCommand({ type: 'extensions/list' })) as {
      extensions: ExtensionSummary[];
    };
    expect(listed.extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: extensionId,
          enabled: true,
          sessionBackend: expect.objectContaining({ id: agentId }),
        }),
      ]),
    );
    expect(data(await runtime.handleCommand({ type: 'agents/status' }))).toMatchObject({
      agents: [{ agentId, state: 'ready' }],
    });
    expect(pushes).toContainEqual(expect.objectContaining({
      type: 'agents/status-updated', status: expect.objectContaining({ agentId, state: 'ready' }),
    }));
  });

  it('publishes one status change rather than duplicate pushes on an explicit refresh', async () => {
    const { runtime, pushes, agentId } = await harness();
    await runtime.handleCommand({ type: 'agents/status', agentId, refresh: true });
    await runtime.handleCommand({ type: 'agents/status', agentId, refresh: true });
    expect(pushes.filter((push) => push.type === 'agents/status-updated' && push.status.agentId === agentId)).toHaveLength(1);
  });

  it('reports a missing CLI automatically without presenting the backend as ready', async () => {
    const { runtime, agentId } = await harness({ notInstalled: true });
    expect(data(await runtime.handleCommand({ type: 'agents/status' }))).toMatchObject({
      agents: [{ agentId, state: 'not-installed' }],
    });
  });

  it('detects a newly enabled extension without visiting backend settings', async () => {
    const { runtime, agentId, extensionId } = await harness();
    await runtime.handleCommand({ type: 'extensions/set_enabled', extensionId, enabled: false });
    expect(data(await runtime.handleCommand({ type: 'agents/status' }))).toMatchObject({
      agents: [{ agentId, state: 'unavailable' }],
    });
    await runtime.handleCommand({ type: 'extensions/set_enabled', extensionId, enabled: true });
    expect(data(await runtime.handleCommand({ type: 'agents/status' }))).toMatchObject({
      agents: [{ agentId, state: 'ready' }],
    });
  });

  it('answers retired inventory commands with migration guidance', async () => {
    const { runtime, agentId } = await harness();
    const commands: HostCommand[] = [
      { type: 'agents/list' },
      { type: 'agents/install', source: { kind: 'bundled', agentId: 'grok' } },
      { type: 'agents/set-enabled', agentId, enabled: false },
      { type: 'agents/uninstall', agentId },
      { type: 'agents/select-runtime', agentId, binaryPath: '/tmp/user-cli' },
    ];
    for (const command of commands) {
      expect(failure(await runtime.handleCommand(command))).toContain('agents-inventory-retired');
    }
  });

  it('disables through the extension and blocks new Runs without starting the adapter', async () => {
    const { runtime, agentId, extensionId } = await harness();
    expect((await runtime.handleCommand({
      type: 'extensions/set_enabled', extensionId, enabled: false,
    })).success).toBe(true);
    const status = data(await runtime.handleCommand({ type: 'agents/status', refresh: true })) as {
      agents: Array<{ state: string; reason: string }>;
    };
    expect(status.agents[0]).toMatchObject({ state: 'unavailable' });
    expect(status.agents[0]?.reason).toContain('disabled');
    const created = await runtime.handleCommand({
      type: 'session/create', input: { agentId, projectPath: '/tmp/agent-project' },
    });
    expect(created.success).toBe(false);
    expect(failure(created)).toContain('agent-plugin-disabled');
  });

  it('uninstalls the extension and leaves session history readable', async () => {
    const { runtime, extensionId } = await harness({ steps: [{ kind: 'text', text: 'kept' }] });
    const created = await runtime.handleCommand({
      type: 'session/create', input: { agentId: 'fixture', projectPath: '/tmp/agent-project' },
    });
    const sessionId = (data(created) as { sessionId: string }).sessionId;
    await runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'one' } });
    const removed = data(await runtime.handleCommand({
      type: 'extensions/uninstall', extensionId, force: true,
    })) as { state: string };
    expect(removed.state).toBe('removed');
    expect((await runtime.handleCommand({ type: 'session/messages', sessionId })).success).toBe(true);
    const listed = data(await runtime.handleCommand({ type: 'extensions/list' })) as {
      extensions: ExtensionSummary[];
    };
    expect(listed.extensions.some((extension) => extension.id === extensionId)).toBe(false);
  });

  it('refuses a staged artifact whose bytes no longer match the declaration', async () => {
    const { rootDir, runtime, extensionId, agentId } = await harness();
    const record = await createExtensionRevisionStore(rootDir).getRecord(extensionId);
    const revision = record?.revisions.find(
      (item) => item.contentRevision === record.selectedRevision,
    );
    if (!revision) throw new Error('fixture revision missing');
    await writeFile(join(revision.packageRoot, 'dist', 'agent.mjs'), 'tampered');
    const created = await runtime.handleCommand({
      type: 'session/create', input: { agentId, projectPath: '/tmp/agent-project' },
    });
    expect(failure(created)).toContain('agent-artifact-integrity');
  });

  it('refuses two enabled extensions that claim the same backend id', async () => {
    const { rootDir, extensionId } = await harness();
    const record = await createExtensionRevisionStore(rootDir).getRecord(extensionId);
    const revision = record?.revisions[0];
    if (!revision) throw new Error('fixture revision missing');
    const second = join(rootDir, 'second-source');
    const { cp } = await import('node:fs/promises');
    await cp(revision.packageRoot, second, { recursive: true });
    await writeFile(join(second, 'marker.txt'), 'second claim');
    const staged = await installExtension({
      piwinRoot: rootDir,
      source: { kind: 'local', path: second },
      name: 'fixture-copy',
    });
    await createExtensionRevisionStore(rootDir).setEnabled(staged.extensionId, true);
    await expect(listExtensionBackends(rootDir)).rejects.toThrow('agent-backend-ambiguous');
  });

  it('refuses a directory that declares neither a Pi module nor a valid session backend', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-agent-invalid-'));
    cleanups.push(async () => {
      await rm(rootDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
    });
    const source = join(rootDir, 'empty-extension');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'readme.txt'), 'not an extension');
    await expect(installExtension({
      piwinRoot: rootDir,
      source: { kind: 'local', path: source },
      name: 'empty',
    })).rejects.toThrow(/must contain index\.ts/);
    expect(await createExtensionRevisionStore(rootDir).listRecords()).toEqual([]);
  });
});
