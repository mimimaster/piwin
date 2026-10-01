/**
 * Host-level integration for installable Agent adapters (ADR 0082).
 *
 * The Host launches whatever artifact the installer verified, so these tests
 * install a real fixture adapter through the real installer and drive the
 * product commands. No vendor CLI and no injected transport are involved.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostPush, HostResponse } from '@piwin/contracts';
import { HostRuntime } from '../host-runtime.js';
import { getPiwinMediaDir, getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { FIXTURE_AGENT_ID, installFixtureAgentAdapter, type FixtureManifestOverrides } from '../testing/agent-plugin-fixture.js';

type Harness = {
  runtime: HostRuntime;
  pushes: HostPush[];
  rootDir: string;
  agentId: string;
  extensionId: string;
};

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.dispose();
    await rm(harness.rootDir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function data(response: HostResponse): unknown {
  if (!response.success) throw new Error(`${response.command}: ${response.error}`);
  return response.data;
}
function failure(response: HostResponse): string {
  if (response.success) throw new Error('expected a failed response');
  return response.error;
}

async function createHarness(script: unknown = {}, agentId = FIXTURE_AGENT_ID, overrides?: FixtureManifestOverrides): Promise<Harness> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-agent-host-'));
  const installed = await installFixtureAgentAdapter(rootDir, { script, agentId, ...(overrides !== undefined ? { overrides } : {}) });
  const runtime = new HostRuntime({
    mode: 'sdk',
    mock: true,
    piwinRoot: rootDir,
    externalAgents: { env: installed.env },
  });
  const pushes: HostPush[] = [];
  runtime.attachPushSink({ id: 'agent-fixture-test', push: (push) => pushes.push(push) });
  const harness = { runtime, pushes, rootDir, agentId, extensionId: installed.extensionId };
  harnesses.push(harness);
  return harness;
}

async function createAgentSession(harness: Harness): Promise<string> {
  const created = await harness.runtime.handleCommand({
    type: 'session/create',
    input: { projectPath: '/tmp/agent-project', agentId: harness.agentId },
  });
  return (data(created) as { sessionId: string }).sessionId;
}

async function waitForRunTerminal(harness: Harness, sessionId: string): Promise<string> {
  let status = '';
  await vi.waitFor(
    () => {
      const push = harness.pushes.find(
        (candidate) => candidate.type === 'run/updated' && candidate.run.sessionId === sessionId &&
          ['completed', 'failed', 'cancelled'].includes(candidate.run.status),
      );
      if (push === undefined || push.type !== 'run/updated') throw new Error('run not terminal');
      status = push.run.status;
    },
    { timeout: 15_000 },
  );
  return status;
}

describe('External agent adapter integration (fixture artifact)', () => {
  it('reports readiness from the installed adapter without the CLI being pre-checked', async () => {
    const harness = await createHarness();
    // Never checked yet: the Host reports why instead of guessing readiness.
    expect(data(await harness.runtime.handleCommand({ type: 'agents/status' }))).toMatchObject({
      agents: [{ agentId: harness.agentId, state: 'unavailable' }],
      installed: [harness.agentId],
    });
    const refreshed = await harness.runtime.handleCommand({ type: 'agents/status', refresh: true });
    expect(data(refreshed)).toMatchObject({ agents: [{ agentId: harness.agentId, state: 'ready', version: '1.0.0' }] });
  });

  it('runs a prompt through the adapter and projects the assistant text', async () => {
    const harness = await createHarness({ steps: [{ kind: 'text', text: 'hello from fixture' }] });
    const sessionId = await createAgentSession(harness);
    const prompt = await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'hi' } });
    expect(prompt.success, prompt.success ? '' : prompt.error).toBe(true);
    expect(await waitForRunTerminal(harness, sessionId)).toBe('completed');
    const messages = data(await harness.runtime.handleCommand({ type: 'session/messages', sessionId })) as {
      messages: Array<{ role: string; text: string }>;
    };
    expect(messages.messages.some((message) => message.role === 'assistant' && message.text.includes('hello from fixture'))).toBe(true);
  });

  it('delivers generated attachments live, persists them and lists the same asset in the library', async () => {
    const harness = await createHarness({
      steps: [
        { kind: 'tool', media: { directoryId: 'images', directory: '.piwin-fixture/images', relativePath: 'frame.png', kind: 'image', prompt: 'fixture portrait' } },
        { kind: 'text', text: 'generated' },
      ],
    });
    const sessionId = await createAgentSession(harness);
    await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'draw' } });
    expect(await waitForRunTerminal(harness, sessionId)).toBe('completed');
    const completed = harness.pushes.find((push) =>
      push.type === 'event' && push.sessionId === sessionId && push.event.type === 'tool/end',
    );
    if (completed?.type !== 'event' || completed.event.type !== 'tool/end') throw new Error('no completed tool');
    expect(completed.event.attachments).toEqual([
      expect.objectContaining({ kind: 'media', source: 'generated', mimeType: 'image/png' }),
    ]);
    const attachment = completed.event.attachments?.[0];
    if (attachment === undefined) throw new Error('no generated attachment');
    expect(attachment.path.startsWith(join(getPiwinMediaDir(getPiwinRoot(harness.rootDir)), sessionId))).toBe(true);
    expect((await readFile(attachment.path)).byteLength).toBeGreaterThan(0);
    expect(data(await harness.runtime.handleCommand({ type: 'session/messages', sessionId }))).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ role: 'assistant', attachments: [attachment] })]),
    });
    expect(data(await harness.runtime.handleCommand({ type: 'media/list', input: {} }))).toMatchObject({
      items: [expect.objectContaining({ assetId: attachment.id, kind: 'image', prompt: 'fixture portrait' })],
    });
  });

  it('bridges an adapter permission request onto the Host pending map', async () => {
    const harness = await createHarness({ steps: [{ kind: 'permission' }, { kind: 'text', text: 'after' }] });
    const sessionId = await createAgentSession(harness);
    await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'act' } });
    let requestId = '';
    await vi.waitFor(
      () => {
        const push = harness.pushes.find((candidate) => candidate.type === 'permission/request' && candidate.sessionId === sessionId);
        if (push === undefined || push.type !== 'permission/request') throw new Error('no permission request');
        requestId = push.requestId;
      },
      { timeout: 15_000 },
    );
    const resolved = await harness.runtime.handleCommand({
      type: 'permission/resolve',
      requestId,
      decision: 'allow',
      backendOptionId: 'allow',
    });
    expect(resolved.success).toBe(true);
    expect(await waitForRunTerminal(harness, sessionId)).toBe('completed');
    const messages = data(await harness.runtime.handleCommand({ type: 'session/messages', sessionId })) as {
      messages: Array<{ role: string; text: string }>;
    };
    expect(messages.messages.some((message) => message.text.includes('decision:{"optionId":"allow"}'))).toBe(true);
  });

  it('cancels a hung adapter prompt as cancelled rather than failed', async () => {
    const harness = await createHarness({ steps: [{ kind: 'text', text: 'started' }, { kind: 'hang' }] });
    const sessionId = await createAgentSession(harness);
    await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'slow' } });
    await vi.waitFor(() => {
      const push = harness.pushes.find((candidate) => candidate.type === 'run/updated' && candidate.run.sessionId === sessionId && candidate.run.status === 'running');
      if (push === undefined) throw new Error('run not running');
    }, { timeout: 15_000 });
    expect((await harness.runtime.handleCommand({ type: 'session/abort', sessionId })).success).toBe(true);
    expect(await waitForRunTerminal(harness, sessionId)).toBe('cancelled');
  });

  it('serves workflows and MCP status through the adapter session', async () => {
    const workflow = { workflowId: 'wf_1', sessionId: 'unknown', title: 'Fixture workflow', status: 'running', reportAvailable: true };
    const harness = await createHarness({
      steps: [{ kind: 'mcp', servers: [{ name: 'fixture-mcp', transport: 'stdio', status: 'connected' }] }, { kind: 'text', text: 'done' }],
      workflows: [workflow],
      workflowReports: { wf_1: '# report' },
    });
    const sessionId = await createAgentSession(harness);
    await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'go' } });
    expect(await waitForRunTerminal(harness, sessionId)).toBe('completed');
    const workflows = data(await harness.runtime.handleCommand({ type: 'agents/workflows', sessionId })) as {
      workflows: Array<{ workflowId: string }>;
    };
    expect(workflows.workflows.map((entry) => entry.workflowId)).toContain('wf_1');
    const report = data(await harness.runtime.handleCommand({
      type: 'agents/workflow-report', sessionId, workflowId: 'wf_1',
    })) as { text: string };
    expect(report.text).toBe('# report');
    const mcp = data(await harness.runtime.handleCommand({ type: 'agents/mcp-status', agentId: harness.agentId })) as {
      servers: Array<{ name: string }>;
    };
    expect(mcp.servers.map((server) => server.name)).toContain('fixture-mcp');
  });

  it('syncs the adapter catalog and writes rename/delete through to it', async () => {
    const harness = await createHarness({
      catalog: [{ backendSessionId: 'vendor-1', title: 'Vendor session', cwd: '/tmp/vendor', lastChangeUnixMs: 1 }],
    });
    const synced = data(await harness.runtime.handleCommand({ type: 'agents/sessions-sync', agentId: harness.agentId })) as {
      created: number;
    };
    expect(synced.created).toBe(1);
    const imported = harness.pushes.find(
      (push) => push.type === 'session/index-updated' && push.op === 'created',
    );
    expect(imported).toBeDefined();
    const sessionId = imported !== undefined && imported.type === 'session/index-updated' ? imported.sessionId : '';
    expect((await harness.runtime.handleCommand({ type: 'session/rename', sessionId, name: 'Renamed by user' })).success).toBe(true);
    expect((await harness.runtime.handleCommand({ type: 'session/delete', sessionId, force: true })).success).toBe(true);
    expect(data(await harness.runtime.handleCommand({ type: 'session/list' }))).toMatchObject({ sessions: [] });
  });

  it('refuses Pi-only commands for adapter sessions with a capability reason', async () => {
    const harness = await createHarness({
      steps: [{ kind: 'text', text: 'activated' }],
      capabilities: {
        agentId: FIXTURE_AGENT_ID,
        operations: { fork: { supported: false, reason: 'fixture cannot fork' } },
      },
    });
    const sessionId = await createAgentSession(harness);
    // Before activation the Host has no adapter declaration, so it refuses with
    // its own agent-agnostic reason rather than guessing.
    const beforeActivation = await harness.runtime.handleCommand({ type: 'session/fork', sessionId, workspaceStrategy: 'shared' });
    expect(beforeActivation.success).toBe(false);
    expect(failure(beforeActivation)).toContain('External agent sessions cannot be forked');
    await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'hi' } });
    expect(await waitForRunTerminal(harness, sessionId)).toBe('completed');
    // Once the adapter declared capabilities, its own reason wins.
    const afterActivation = await harness.runtime.handleCommand({ type: 'session/fork', sessionId, workspaceStrategy: 'shared' });
    expect(afterActivation.success).toBe(false);
    expect(failure(afterActivation)).toContain('fixture cannot fork');
  });

  it('blocks new Runs while disabled and preserves history on uninstall', async () => {
    const harness = await createHarness({ steps: [{ kind: 'text', text: 'first' }] });
    const sessionId = await createAgentSession(harness);
    await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'one' } });
    expect(await waitForRunTerminal(harness, sessionId)).toBe('completed');
    expect((await harness.runtime.handleCommand({
      type: 'extensions/set_enabled', extensionId: harness.extensionId, enabled: false,
    })).success).toBe(true);
    const blocked = await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'two' } });
    expect(blocked.success).toBe(false);
    expect(failure(blocked)).toContain('agent-plugin-disabled');
    const queued = await harness.runtime.handleCommand({
      type: 'session/queued-turn-submit', sessionId, queuedTurnId: 'queued-1', userMessageId: 'message-1',
      input: { text: 'queued' },
    });
    expect(queued.success).toBe(false);
    expect(failure(queued)).toContain('agent-plugin-disabled');
    const removed = data(await harness.runtime.handleCommand({
      type: 'extensions/uninstall', extensionId: harness.extensionId, force: true,
    })) as { state: string };
    expect(removed.state).toBe('removed');
    const history = await harness.runtime.handleCommand({ type: 'session/messages', sessionId });
    expect(history.success).toBe(true);
    expect(data(history)).toMatchObject({ messages: expect.any(Array) });
  });

  it('migrates an old binding only after an explicit compatible confirmation', async () => {
    const harness = await createHarness({ steps: [{ kind: 'text', text: 'kept' }] }, FIXTURE_AGENT_ID, {
      unversionedBindingCompatible: true,
    });
    const sessionId = await createAgentSession(harness);
    await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'keep me' } });
    expect(await waitForRunTerminal(harness, sessionId)).toBe('completed');
    const before = data(await harness.runtime.handleCommand({ type: 'session/backend-get', sessionId })) as {
      bindingReadiness: { state: string; revision?: string; targetRevision?: string };
    };
    expect(before.bindingReadiness.state).toBe('ready');
    const indexPath = getPiwinSessionIndexPath(harness.rootDir);
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
      sessions: Array<{ id: string; backend?: { pluginRevision?: string; backendSessionId?: string } }>;
    };
    const row = index.sessions.find((session) => session.id === sessionId);
    const nativeId = row?.backend?.backendSessionId;
    expect(nativeId).toEqual(expect.any(String));
    if (row?.backend) delete row.backend.pluginRevision;
    await writeFile(indexPath, JSON.stringify(index));
    const stale = await harness.runtime.handleCommand({
      type: 'agents/confirm-binding-migration', sessionId, expectedRevision: 'b'.repeat(64), targetRevision: 'c'.repeat(64),
    });
    expect(failure(stale)).toContain('agent-migration-stale');
    const offered = data(await harness.runtime.handleCommand({ type: 'session/backend-get', sessionId })) as {
      bindingReadiness: { state: string; expectedRevision: string | null; targetRevision: string; compatible: boolean };
    };
    expect(offered.bindingReadiness).toMatchObject({ state: 'migration-required', expectedRevision: null, compatible: true });
    const migrated = data(await harness.runtime.handleCommand({
      type: 'agents/confirm-binding-migration',
      sessionId,
      expectedRevision: null,
      targetRevision: offered.bindingReadiness.targetRevision,
    })) as { backendSessionId?: string; pluginRevision: string };
    expect(migrated.backendSessionId).toBe(nativeId);
    expect(migrated.pluginRevision).toBe(offered.bindingReadiness.targetRevision);
    const after = data(await harness.runtime.handleCommand({ type: 'session/messages', sessionId })) as { messages: unknown[] };
    expect(after.messages.length).toBeGreaterThan(0);
  });
});
