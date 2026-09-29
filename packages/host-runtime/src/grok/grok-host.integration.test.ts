import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeGrokAgent, FAKE_GROK_SECRET, type FakeGrokAgent } from '@piwin/acp-agent/testing';
import type { HostPush } from '@piwin/contracts';
import { HostRuntime } from '../host-runtime.js';

type Harness = { runtime: HostRuntime; agent: FakeGrokAgent; pushes: HostPush[]; rootDir: string };

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.dispose();
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

async function createHarness(agent: FakeGrokAgent): Promise<Harness> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-grok-host-'));
  const runtime = new HostRuntime({
    mode: 'sdk',
    mock: true,
    piwinRoot: rootDir,
    grok: {
      createTransport: () => agent.createTransport(),
      detect: async () => ({
        agentId: 'grok',
        state: 'ready',
        binaryPath: '/fake/grok',
        version: '1.0.44',
        supportStatus: 'verified',
        checkedAt: new Date().toISOString(),
      }),
    },
  });
  const pushes: HostPush[] = [];
  runtime.attachPushSink({ id: 'grok-test', push: (push) => pushes.push(push) });
  const harness = { runtime, agent, pushes, rootDir };
  harnesses.push(harness);
  return harness;
}

async function createGrokSession(runtime: HostRuntime): Promise<string> {
  const created = await runtime.handleCommand({
    type: 'session/create',
    input: { projectPath: '/tmp/grok-project', agentId: 'grok' },
  });
  if (!created.success) throw new Error(created.error);
  return (created.data as { sessionId: string }).sessionId;
}

async function waitForRunTerminal(harness: Harness, runId: string): Promise<string> {
  let status = '';
  await vi.waitFor(
    () => {
      const run = harness.pushes.find(
        (push) => push.type === 'run/updated' && push.run.runId === runId && ['completed', 'failed', 'cancelled'].includes(push.run.status),
      );
      if (run === undefined || run.type !== 'run/updated') throw new Error('not terminal');
      status = run.run.status;
    },
    { timeout: 5000 },
  );
  return status;
}

describe('Grok sessions through HostRuntime', () => {
  it('runs a turn with a tool and Grok permission options, then resumes and deletes', async () => {
    const agent = createFakeGrokAgent({
      turns: [
        [
          { kind: 'text', text: 'Editing' },
          { kind: 'permission', toolCallId: 'call-1', title: 'Write `a.txt`', path: '/tmp/grok-project/a.txt' },
          { kind: 'tool', toolCallId: 'call-1', name: 'write', acpKind: 'edit', title: 'Write `a.txt`', path: '/tmp/grok-project/a.txt' },
          { kind: 'text', text: 'done' },
        ],
        [{ kind: 'text', text: 'second' }],
      ],
    });
    const harness = await createHarness(agent);
    const { runtime, pushes } = harness;
    const sessionId = await createGrokSession(runtime);

    const prompt = await runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'write a.txt' } });
    if (!prompt.success) throw new Error(prompt.error);
    const runId = (prompt.data as { runId: string }).runId;

    let requestId = '';
    await vi.waitFor(() => {
      const request = pushes.find((push) => push.type === 'permission/request' && push.sessionId === sessionId);
      if (request === undefined || request.type !== 'permission/request') throw new Error('no request');
      expect(request.context?.backendOptions?.map((option) => option.optionId)).toEqual([
        'allow-edits-session',
        'allow-once',
        'reject-once',
      ]);
      requestId = request.requestId;
    });

    const mismatch = await runtime.handleCommand({
      type: 'permission/resolve',
      requestId,
      decision: 'allow',
      backendOptionId: 'reject-once',
    });
    expect(mismatch).toMatchObject({ success: false, error: 'backend-option-decision-mismatch' });
    const resolved = await runtime.handleCommand({
      type: 'permission/resolve',
      requestId,
      decision: 'allow',
      backendOptionId: 'allow-once',
    });
    expect(resolved.success).toBe(true);
    expect(await waitForRunTerminal(harness, runId)).toBe('completed');

    const resumed = await runtime.handleCommand({ type: 'session/resume', sessionId });
    if (!resumed.success) throw new Error(resumed.error);
    const data = resumed.data as {
      messages: Array<{ role: string; text: string; tools?: Array<{ presentation?: { changedPaths?: string[] } }> }>;
      backendCapabilities?: { agentId: string; operations: { images: { supported: boolean } } };
      backendOptions?: { currentModelId?: string };
    };
    expect(data.backendCapabilities?.agentId).toBe('grok');
    expect(data.backendCapabilities?.operations.images.supported).toBe(false);
    expect(data.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(data.messages.flatMap((message) => message.tools ?? []).at(0)?.presentation?.changedPaths).toEqual([
      '/tmp/grok-project/a.txt',
    ]);

    // Title came from Grok, not the Pi auto-namer.
    await vi.waitFor(() => {
      expect(pushes.some((push) => push.type === 'session/name-updated' && push.name === 'Fake title')).toBe(true);
    });

    // Secrets from the MCP notification never reach any client push.
    expect(JSON.stringify(pushes)).not.toContain(FAKE_GROK_SECRET);
    expect(JSON.stringify(pushes)).not.toContain('secret-host');

    // Pi-only operations are refused.
    const pause = await runtime.handleCommand({ type: 'session/pause', sessionId });
    expect(pause).toMatchObject({ success: false, problem: { code: 'backend-operation-unsupported' } });

    // Model switch writes through and persists.
    const setModel = await runtime.handleCommand({ type: 'session/backend-set', sessionId, modelId: 'grok-4.7' });
    expect(setModel.success).toBe(true);

    // Rename writes through to Grok.
    const renamed = await runtime.handleCommand({ type: 'session/rename', sessionId, name: 'Renamed' });
    expect(renamed.success).toBe(true);
    const backendSessionId = [...agent.sessions.keys()][0];
    expect(backendSessionId).toBeDefined();
    expect(agent.sessions.get(backendSessionId ?? '')?.title).toBe('Renamed');

    // Permanent delete removes the Grok session too.
    const deleted = await runtime.handleCommand({ type: 'session/delete', sessionId, force: true });
    expect(deleted).toMatchObject({ success: true, data: { deleted: true } });
    expect(agent.sessions.size).toBe(0);
    await vi.waitFor(() => expect(agent.liveProcesses).toBe(0));
  }, 20_000);

  it('rejecting a Grok permission ends the turn without failure', async () => {
    const agent = createFakeGrokAgent({
      turns: [[{ kind: 'permission', toolCallId: 'call-1', title: 'Write `a.txt`', path: '/tmp/grok-project/a.txt' }]],
    });
    const harness = await createHarness(agent);
    const sessionId = await createGrokSession(harness.runtime);
    const prompt = await harness.runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'x' } });
    if (!prompt.success) throw new Error(prompt.error);
    const runId = (prompt.data as { runId: string }).runId;
    let requestId = '';
    await vi.waitFor(() => {
      const request = harness.pushes.find((push) => push.type === 'permission/request');
      if (request?.type !== 'permission/request') throw new Error('none');
      requestId = request.requestId;
    });
    await harness.runtime.handleCommand({ type: 'permission/resolve', requestId, decision: 'deny', backendOptionId: 'reject-once' });
    expect(await waitForRunTerminal(harness, runId)).toBe('completed');
  }, 20_000);

  it('refuses images and unknown agents', async () => {
    const harness = await createHarness(createFakeGrokAgent());
    const unknown = await harness.runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/grok-project', agentId: 'nope' },
    });
    expect(unknown).toMatchObject({ success: false, error: 'unknown-agent: nope' });
    const sessionId = await createGrokSession(harness.runtime);
    const withImage = await harness.runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: {
        text: 'look',
        attachments: [{ kind: 'media', mediaId: 'm1', mimeType: 'image/png', path: '/tmp/x.png' } as never],
      },
    });
    expect(withImage).toMatchObject({ success: false, problem: { code: 'backend-operation-unsupported' } });
  });

  it('imports TUI-created sessions from the Grok catalog and drops deleted ones', async () => {
    const agent = createFakeGrokAgent({
      sessions: [
        { sessionId: 'tui-1', cwd: '/tmp/grok-project', title: 'From TUI', lastChangeUnixMs: Date.now(), history: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi there' }] },
      ],
    });
    const harness = await createHarness(agent);
    const synced = await harness.runtime.handleCommand({ type: 'agents/sessions-sync', agentId: 'grok' });
    expect(synced).toMatchObject({ success: true, data: { created: 1 } });
    const created = harness.pushes.find((push) => push.type === 'session/index-updated' && push.op === 'created');
    if (created?.type !== 'session/index-updated') throw new Error('no create push');
    expect(created.session).toMatchObject({ name: 'From TUI', backend: { agentId: 'grok' } });

    // First open replays Grok history into the projection.
    const prompt = await harness.runtime.handleCommand({ type: 'session/prompt', sessionId: created.sessionId, input: { text: 'again' } });
    if (!prompt.success) throw new Error(prompt.error);
    await waitForRunTerminal(harness, (prompt.data as { runId: string }).runId);
    const resumed = await harness.runtime.handleCommand({ type: 'session/resume', sessionId: created.sessionId });
    if (!resumed.success) throw new Error(resumed.error);
    const texts = (resumed.data as { messages: Array<{ text: string }> }).messages.map((message) => message.text);
    expect(texts.slice(0, 2)).toEqual(['hello', 'hi there']);

    agent.sessions.delete('tui-1');
    const second = await harness.runtime.handleCommand({ type: 'agents/sessions-sync', agentId: 'grok' });
    expect(second).toMatchObject({ success: true, data: { removed: 1 } });
  }, 20_000);
});
