import { describe, expect, it } from 'vitest';
import { createFakeGrokAgent, FAKE_GROK_SECRET } from '@piwin/acp-agent/testing';
import type { AgentEvent, SessionBackendOptions } from '@piwin/contracts';
import { GrokSessionHandle, type GrokPermissionDecision, type GrokSessionPorts } from './grok-session-handle.js';

function createPorts(
  agent: ReturnType<typeof createFakeGrokAgent>,
  overrides: Partial<GrokSessionPorts> = {},
): GrokSessionPorts & { options: SessionBackendOptions[]; titles: string[]; closed: string[] } {
  const options: SessionBackendOptions[] = [];
  const titles: string[] = [];
  const closed: string[] = [];
  return {
    createTransport: () => agent.createTransport(),
    requestPermission: async () => ({ optionId: 'allow-once' }),
    onOptionsChanged: (snapshot) => options.push(snapshot),
    onTitle: (title) => titles.push(title),
    onTransportClosed: (reason) => closed.push(reason),
    getCurrentRunId: () => 'run-1',
    options,
    titles,
    closed,
    ...overrides,
  };
}

function collect(handle: GrokSessionHandle): AgentEvent[] {
  const events: AgentEvent[] = [];
  handle.subscribe((event) => events.push(event));
  return events;
}

describe('GrokSessionHandle', () => {
  it('creates a session, streams text + tools, and reports usage', async () => {
    const agent = createFakeGrokAgent({
      turns: [[
        { kind: 'text', text: 'Writing ' },
        { kind: 'tool', toolCallId: 'call-1', name: 'write', acpKind: 'edit', title: 'Write `a.txt`', path: '/ws/a.txt' },
        { kind: 'text', text: 'done' },
      ]],
    });
    const ports = createPorts(agent);
    const opened = await GrokSessionHandle.open({ productSessionId: 'p-1', cwd: '/ws' }, ports);
    expect(opened.backendSessionId).toBe('grok-session-1');
    expect(opened.agentVersion).toBe('1.0.44');
    const events = collect(opened.handle);

    const outcome = await opened.handle.prompt({ text: 'go' });
    expect(outcome).toEqual({ status: 'completed', stopReason: 'stop' });
    const kinds = events.map((event) => event.type);
    expect(kinds).toEqual([
      'message/start',
      'message/text_delta',
      'message/end',
      'tool/start',
      'tool/update',
      'tool/update',
      'tool/end',
      'message/start',
      'message/text_delta',
      'message/end',
      'usage/finalized',
    ]);
    expect(events.find((event) => event.type === 'tool/end')).toMatchObject({
      presentation: { kind: 'filesystem', changedPaths: ['/ws/a.txt'], actionVerb: 'Edited' },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'usage/finalized',
      measurement: { sessionId: 'p-1', runId: 'run-1', promptTokens: 12, completionTokens: 3, cacheReadTokens: 4, totalTokens: 15 },
    });
    expect(ports.titles).toEqual(['Fake title']);
    expect(ports.options.at(-1)?.commands.map((command) => command.name)).toEqual(['compact']);
    await opened.handle.release();
    expect(agent.liveProcesses).toBe(0);
  });

  it('never exposes the secret-bearing MCP notification', async () => {
    const agent = createFakeGrokAgent();
    const ports = createPorts(agent);
    const opened = await GrokSessionHandle.open({ productSessionId: 'p-1', cwd: '/ws' }, ports);
    const events = collect(opened.handle);
    await opened.handle.prompt({ text: 'hi' });
    const serialized = JSON.stringify({ events, options: ports.options, titles: ports.titles });
    expect(serialized).not.toContain(FAKE_GROK_SECRET);
    expect(serialized).not.toContain('secret-host');
    await opened.handle.release();
  });

  it('passes Grok permission options through and treats reject as handled', async () => {
    const agent = createFakeGrokAgent({ turns: [[{ kind: 'permission', toolCallId: 'call-1', title: 'Write `a.txt`', path: '/ws/a.txt' }]] });
    const seen: string[][] = [];
    const ports = createPorts(agent, {
      requestPermission: async ({ prompt }): Promise<GrokPermissionDecision> => {
        seen.push(prompt.options.map((option) => option.optionId));
        return { optionId: 'reject-once' };
      },
    });
    const opened = await GrokSessionHandle.open({ productSessionId: 'p-1', cwd: '/ws' }, ports);
    const outcome = await opened.handle.prompt({ text: 'write it' });
    expect(seen).toEqual([['allow-edits-session', 'allow-once', 'reject-once']]);
    expect(outcome).toEqual({ status: 'completed', stopReason: 'handled' });
    await opened.handle.release();
  });

  it('cancels a running turn and reports aborted', async () => {
    const agent = createFakeGrokAgent({ turns: [[{ kind: 'text', text: 'partial' }, { kind: 'wait-cancel' }]] });
    const opened = await GrokSessionHandle.open({ productSessionId: 'p-1', cwd: '/ws' }, createPorts(agent));
    const events = collect(opened.handle);
    const running = opened.handle.prompt({ text: 'long' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await opened.handle.abort();
    await expect(running).resolves.toEqual({ status: 'aborted', stopReason: 'aborted' });
    expect(events.some((event) => event.type === 'message/text_delta')).toBe(true);
    expect(agent.received.some((entry) => entry.method === 'session/cancel')).toBe(true);
    await opened.handle.release();
  });

  it('reports a crash as a backend worker failure', async () => {
    const agent = createFakeGrokAgent({ turns: [[{ kind: 'wait-cancel' }]] });
    const ports = createPorts(agent);
    const opened = await GrokSessionHandle.open({ productSessionId: 'p-1', cwd: '/ws' }, ports);
    const running = opened.handle.prompt({ text: 'go' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    agent.crash();
    await expect(running).resolves.toMatchObject({ status: 'failed', failure: { code: 'backend-worker-crash' } });
    expect(ports.closed).toEqual(['crashed']);
  });

  it('resumes without replay and loads with replay', async () => {
    const agent = createFakeGrokAgent({
      sessions: [{ sessionId: 'g-1', cwd: '/ws', lastChangeUnixMs: 1, history: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }] }],
    });
    const resumed = await GrokSessionHandle.open({ productSessionId: 'p-1', cwd: '/ws', backendSessionId: 'g-1' }, createPorts(agent));
    expect(resumed.replayEvents).toEqual([]);
    await resumed.handle.release();

    const loaded = await GrokSessionHandle.open({ productSessionId: 'p-1', cwd: '/ws', backendSessionId: 'g-1', replay: true }, createPorts(agent));
    const roles = loaded.replayEvents
      .filter((event): event is Extract<AgentEvent, { type: 'message/start' }> => event.type === 'message/start')
      .map((event) => event.role);
    expect(roles).toEqual(['user', 'assistant']);
    await loaded.handle.release();
  });

  it('interjects into the running turn and reports delivery', async () => {
    const agent = createFakeGrokAgent({ turns: [[{ kind: 'wait-cancel' }]] });
    const opened = await GrokSessionHandle.open({ productSessionId: 'p-1', cwd: '/ws' }, createPorts(agent));
    const lifecycle: string[] = [];
    opened.handle.subscribeRunInterventions(async (event) => {
      lifecycle.push(event.type);
      return { accepted: true };
    });
    const running = opened.handle.prompt({ text: 'go' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await opened.handle.armRunIntervention({ interventionId: 'i-1', revision: 1, sessionId: 'p-1', runId: 'run-1', runtimeGenerationId: 'g', sequence: 1, text: 'stop at 10' });
    expect(lifecycle).toEqual(['claim', 'applied']);
    expect(agent.received.find((entry) => entry.method === '_x.ai/interject')?.params).toEqual({ sessionId: 'grok-session-1', text: 'stop at 10' });
    await opened.handle.abort();
    await running;
    await opened.handle.release();
  });

  it('switches model/effort and confirms only acknowledged modes', async () => {
    const agent = createFakeGrokAgent();
    const ports = createPorts(agent);
    const opened = await GrokSessionHandle.open({ productSessionId: 'p-1', cwd: '/ws', modelId: 'grok-4.7', effortId: 'low' }, ports);
    expect(opened.handle.getBackendOptions()).toMatchObject({ currentModelId: 'grok-4.7', currentEffortId: 'low' });
    await opened.handle.setMode('auto');
    expect(opened.handle.getBackendOptions()).toMatchObject({ currentModeId: 'auto', modeConfirmed: false });
    await opened.handle.setMode('plan');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(opened.handle.getBackendOptions()).toMatchObject({ currentModeId: 'plan', modeConfirmed: true });
    await expect(opened.handle.setModel('nope')).rejects.toThrow('unknown-grok-model');
    await expect(opened.handle.steer()).rejects.toThrow('steer-unsupported');
    await opened.handle.release();
  });
});
