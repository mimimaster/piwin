import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, BackendRunInterventionEvent, SessionBackendOptions } from '@piwin/contracts';
import { AgentPluginSession } from './agent-plugin-session.js';

const FIXTURE = `
import { createInterface } from 'node:readline';
const mode = process.env.PLUGIN_FIXTURE_MODE ?? 'normal';
const lines = createInterface({ input: process.stdin });
const write = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
const options = { models: [{ id: 'grok-4', label: 'Grok 4' }], efforts: [], modes: [], commands: [] };
let promptFrame;
let awaitingInterject;
let interjectAccepted = false;
const ok = (frame, result) => write({ protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: true, result });
const fail = (frame, code, message) => write({ protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: false, error: { code, message } });
const emit = (scope, emission) => write({ protocolVersion: 1, kind: 'event', scope, emission });

lines.on('line', (line) => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  if (frame.kind === 'response') {
    if (frame.method === 'intervention/event') {
      interjectAccepted = frame.result?.accepted === true;
      if (interjectAccepted) {
        write({ protocolVersion: 1, kind: 'event', scope: frame.scope, emission: { type: 'agent', event: { kind: 'text', text: 'claimed' } } });
        emit(frame.scope, { type: 'agent', event: { kind: 'text', text: 'applied' } });
      }
      if (awaitingInterject) { ok(awaitingInterject, null); awaitingInterject = undefined; }
    }
    return;
  }
  const method = frame.method;
  if (method === 'plugin/initialize') return ok(frame, { agentId: frame.params.agentId, protocolVersion: 1 });
  if (method === 'session/new' || method === 'session/load' || method === 'session/resume') {
    emit(frame.scope, { type: 'options', options });
    return ok(frame, { backendSessionId: 'backend-1', agentVersion: '1.0.44', capabilities: {}, options, replayEvents: [] });
  }
  if (method === 'session/prompt') {
    emit(frame.scope, { type: 'agent', event: { kind: 'text', text: 'a' }, media: [{ directoryId: 'images', relativePath: 'shot.png', kind: 'image', importKey: 'k1' }] });
    emit(frame.scope, { type: 'agent', event: { kind: 'text', text: 'b' } });
    emit(frame.scope, { type: 'title', title: 'Renamed by backend' });
    if (mode === 'hang-prompt') { promptFrame = frame; return; }
    return ok(frame, { status: 'completed', stopReason: 'stop' });
  }
  if (method === 'session/cancel') {
    if (promptFrame) { ok(promptFrame, { status: 'aborted', stopReason: 'aborted' }); promptFrame = undefined; }
    return ok(frame, null);
  }
  if (method === 'session/interject') {
    awaitingInterject = frame;
    write({ protocolVersion: 1, kind: 'request', scope: frame.scope, requestId: 'iv-1', method: 'intervention/event', params: { type: 'claim', interventionId: frame.params.interventionId, revision: frame.params.revision, runId: frame.params.runId, runtimeGenerationId: frame.params.runtimeGenerationId } });
    return;
  }
  if (method === 'session/model' || method === 'session/mode' || method === 'session/effort') return ok(frame, options);
  if (method === 'plugin/dispose' || method === 'session/release') return ok(frame, null);
  return fail(frame, 'unsupported', 'not served by fixture');
});
`;

const SCOPE = { sessionId: 'product-1', runtimeGenerationId: 'gen-1' };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

async function harness(mode = 'normal', overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'piwin-plugin-session-'));
  const entrypoint = join(root, 'agent.mjs');
  await writeFile(entrypoint, FIXTURE);
  const order: string[] = [];
  const events: AgentEvent[] = [];
  const titles: string[] = [];
  const importMedia = vi.fn(async () => { order.push('import'); return undefined; });
  const session = await AgentPluginSession.open({
    entrypoint, agentId: 'grok', pluginRevision: 'rev-1', runtime: {},
    cwd: '/tmp', binding: { agentId: 'grok' } as never, mode: 'new', scope: SCOPE,
    ports: {
      requestPermission: async () => ({ optionId: 'allow' }),
      importMedia,
      onTitle: (title) => titles.push(title),
      getCurrentRunId: () => 'run-1',
      ...overrides,
    },
    env: { ...process.env, PLUGIN_FIXTURE_MODE: mode },
  });
  session.session.subscribe((event) => { order.push('event'); events.push(event); });
  cleanups.push(async () => { await session.session.release().catch(() => undefined); await rm(root, { recursive: true, force: true }); });
  return { session: session.session, opened: session.opened, order, events, titles, importMedia };
}

describe('Bridge-backed Agent plugin session handle', () => {
  it('opens a session and exposes backend identity and options', async () => {
    const { session, opened } = await harness();
    expect(session.id).toBe('product-1');
    expect(session.backendAgentId).toBe('grok');
    expect(opened.backendSessionId).toBe('backend-1');
    expect(opened.agentVersion).toBe('1.0.44');
    expect(session.getBackendOptions()).toMatchObject({ models: [{ id: 'grok-4' }] });
  });

  it('imports declared media before delivering the event, in arrival order', async () => {
    const { session, opened, order, events, titles } = await harness();
    const outcome = await session.prompt({ text: 'hello' });
    expect(outcome).toEqual({ status: 'completed', stopReason: 'stop' });
    expect(events.map((event) => (event as { text?: string }).text)).toEqual(['a', 'b']);
    expect(order).toEqual(['import', 'event', 'event']);
    expect(titles).toEqual(['Renamed by backend']);
  });

  it('keeps the ordered stream alive when a media import fails', async () => {
    const importMedia = vi.fn(async () => { throw new Error('media-import-failed'); });
    const { session, events } = await harness('normal', { importMedia });
    await session.prompt({ text: 'hello' });
    expect(events.map((event) => (event as { text?: string }).text)).toEqual(['a', 'b']);
  });

  it('publishes backend option changes to the Host callback', async () => {
    const onOptionsChanged = vi.fn<(options: SessionBackendOptions) => void>();
    const { session } = await harness('normal', { onOptionsChanged });
    await session.setModel('grok-4');
    expect(onOptionsChanged).toHaveBeenCalled();
  });

  it('bridges an intervention claim and reports it applied', async () => {
    const { session, events } = await harness('hang-prompt');
    const seen: string[] = [];
    session.subscribeRunInterventions(async (event: BackendRunInterventionEvent) => {
      seen.push(event.type);
      return { accepted: true };
    });
    const prompt = session.prompt({ text: 'slow' });
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    await session.armRunIntervention({
      interventionId: 'i1', revision: 1, sessionId: 'product-1', runId: 'run-1',
      runtimeGenerationId: 'gen-1', sequence: 1, text: 'stop',
    });
    await vi.waitFor(() => expect(seen).toEqual(['claim']));
    await vi.waitFor(() =>
      expect(events.some((event) => (event as { text?: string }).text === 'applied')).toBe(true),
    );
    await session.abort();
    await expect(prompt).resolves.toMatchObject({ status: 'aborted' });
  });

  it('reports a cancelled prompt as aborted rather than failed', async () => {
    const { session } = await harness('hang-prompt');
    const prompt = session.prompt({ text: 'slow' });
    await vi.waitFor(() => expect(session.getBackendOptions()).toBeDefined());
    await session.abort();
    await expect(prompt).resolves.toMatchObject({ status: 'aborted', stopReason: 'aborted' });
  });

  it('refuses Pi-only surfaces and stops after release', async () => {
    const { session } = await harness();
    await expect(session.steer()).rejects.toThrow('steer-unsupported');
    await expect(session.followUp()).rejects.toThrow('follow-up-unsupported');
    expect(await session.getMessages()).toEqual([]);
    expect(await session.getTree()).toEqual({ root: null, activeLeafId: null });
    await session.release();
    await expect(session.prompt({ text: 'after release' })).rejects.toThrow('released');
  });
});
