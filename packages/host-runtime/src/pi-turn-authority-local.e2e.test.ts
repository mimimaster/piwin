import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent, HostPush, SessionHandle } from '@piwin/contracts';
import type { BackendSessionHandle } from '@piwin/agent-host';
import {
  createTurnAuthorityLocalHome,
  FIXTURE_MODEL_ID,
  FIXTURE_PROVIDER_ID,
  openTurnAuthorityBackend,
  startOpenAiSseFixture,
  type TurnAuthorityBackend,
  type TurnAuthorityBackendMode,
  type TurnAuthorityLocalHome,
} from '@piwin/agent-host/testing';
import { handleSessionLiveCommand } from './commands/session-live-commands.js';
import { createPromptContext } from './commands/session-live-test-context.js';
import type { SessionLiveContext } from './commands/session-live-context.js';

const modes: TurnAuthorityBackendMode[] = ['sdk', 'rpc'];
const DELETED_WATCHDOG_CODES = [
  'model-connect-timeout',
  'model-first-token-timeout',
  'model-turn-timeout',
  'mcp-timeout',
] as const;

describe.each(modes)('Host turn authority local SSE (%s)', (mode) => {
  let home: TurnAuthorityLocalHome | undefined;
  let backend: TurnAuthorityBackend | undefined;

  afterEach(async () => {
    await backend?.close();
    backend = undefined;
    await home?.close();
    home = undefined;
  });

  it(
    'accepts session/prompt immediately and terminalizes thinking-only stop once',
    async () => {
      const fixture = await startOpenAiSseFixture('thinking-only-stop');
      try {
        home = await createTurnAuthorityLocalHome();
        backend = await openTurnAuthorityBackend({
          mode,
          home,
          baseUrl: fixture.baseUrl,
          sessionId: `host-think-${mode}`,
        });
        const agentEvents: AgentEvent[] = [];
        const unsubscribe = backend.handle.subscribe((event) => {
          agentEvents.push(event);
        });
        const live = bindBackendSession(backend.handle);
        const response = await handleSessionLiveCommand(
          {
            type: 'session/prompt',
            sessionId: live.session.id,
            input: { text: 'fixture' },
          },
          undefined,
          live.context,
        );
        expect(response).toMatchObject({
          success: true,
          command: 'session/prompt',
        });
        const accepted = response?.success === true ? response.data : undefined;
        expect(accepted).toMatchObject({ sessionId: live.session.id });
        const runId =
          accepted && typeof accepted === 'object' && 'runId' in accepted
            ? accepted.runId
            : undefined;
        expect(typeof runId).toBe('string');
        expect(live.context.getForegroundRun(live.session.id)?.runId).toBe(runId);

        await waitForIdle(live.context, live.session.id);
        unsubscribe();

        const terminals = live.events.filter(
          (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
            message.type === 'run/terminal',
        );
        expect(terminals).toHaveLength(1);
        expect(terminals[0]?.run).toMatchObject({
          runId,
          status: 'completed',
          agentStopReason: 'stop',
        });
        expect(agentEvents.some((event) => event.type === 'error')).toBe(false);
        expectWatchdogAbsent(live.events);
        if (typeof runId === 'string') {
          for (const event of agentEvents) {
            if (event.type === 'session/started' || event.type === 'session/ended') {
              continue;
            }
            if ('runId' in event) {
              expect(event.runId).toBe(runId);
            }
          }
        }
      } finally {
        await fixture.close();
      }
    },
    60_000,
  );

  it(
    'keeps one completed Run after native missing-finish retry succeeds',
    async () => {
      const fixture = await startOpenAiSseFixture('missing-finish-then-stop');
      try {
        home = await createTurnAuthorityLocalHome();
        backend = await openTurnAuthorityBackend({
          mode,
          home,
          baseUrl: fixture.baseUrl,
          sessionId: `host-retry-${mode}`,
        });
        const live = bindBackendSession(backend.handle);
        const response = await handleSessionLiveCommand(
          {
            type: 'session/prompt',
            sessionId: live.session.id,
            input: { text: 'fixture' },
          },
          undefined,
          live.context,
        );
        expect(response).toMatchObject({ success: true });
        await waitForIdle(live.context, live.session.id);
        expect(fixture.requestCount()).toBe(2);
        const terminals = live.events.filter(
          (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
            message.type === 'run/terminal',
        );
        expect(terminals).toHaveLength(1);
        expect(terminals[0]?.run).toMatchObject({
          status: 'completed',
          agentStopReason: 'stop',
        });
        expectWatchdogAbsent(live.events);
      } finally {
        await fixture.close();
      }
    },
    60_000,
  );

  it(
    'fails a keep-alive stall from the Agent outcome, not a Host watchdog',
    async () => {
      const fixture = await startOpenAiSseFixture('keep-alive-stall');
      try {
        home = await createTurnAuthorityLocalHome();
        backend = await openTurnAuthorityBackend({
          mode,
          home,
          baseUrl: fixture.baseUrl,
          sessionId: `host-stall-${mode}`,
        });
        const live = bindBackendSession(backend.handle);
        const response = await handleSessionLiveCommand(
          {
            type: 'session/prompt',
            sessionId: live.session.id,
            input: { text: 'fixture' },
          },
          undefined,
          live.context,
        );
        expect(response).toMatchObject({ success: true });
        await waitForIdle(live.context, live.session.id);

        const terminals = live.events.filter(
          (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
            message.type === 'run/terminal',
        );
        expect(terminals).toHaveLength(1);
        expect(terminals[0]?.run).toMatchObject({
          status: 'failed',
          failure: { code: 'model-stream-stalled', origin: 'transport' },
        });
        expectWatchdogAbsent(live.events);
      } finally {
        await fixture.close();
      }
    },
    60_000,
  );
});

function bindBackendSession(handle: BackendSessionHandle): {
  session: SessionHandle;
  context: SessionLiveContext;
  events: HostPush[];
} {
  let context: SessionLiveContext | undefined;
  const session: SessionHandle = {
    id: handle.id,
    async prompt(input) {
      const runId = context?.getForegroundRun(handle.id)?.runId;
      if (runId === undefined) {
        throw new Error('foreground backend prompt requires runId');
      }
      return handle.prompt({
        text: input.text,
        runId,
        model: {
          protocol: 'openai-compatible',
          providerId: FIXTURE_PROVIDER_ID,
          modelId: FIXTURE_MODEL_ID,
        },
      });
    },
    steer: (message) => handle.steer(message),
    followUp: (message) => handle.followUp(message),
    abort: () => handle.abort(),
    getMessages: async () => [],
    getTree: async () => ({ root: null, activeLeafId: null }),
    subscribe: (listener) => handle.subscribe(listener),
  };
  const prompt = createPromptContext(session);
  context = prompt.context;
  return { session, context: prompt.context, events: prompt.events };
}

async function waitForIdle(context: SessionLiveContext, sessionId: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    if (context.getForegroundRun(sessionId) === undefined) {
      return;
    }
    await delay(25);
  }
  throw new Error(`run for ${sessionId} did not terminalize`);
}

function expectWatchdogAbsent(events: readonly HostPush[]): void {
  for (const message of events) {
    if (message.type !== 'run/terminal' && message.type !== 'run/updated') {
      continue;
    }
    const code = message.run.terminalCode;
    if (code !== undefined) {
      expect(DELETED_WATCHDOG_CODES.includes(code as (typeof DELETED_WATCHDOG_CODES)[number])).toBe(
        false,
      );
    }
    const text = `${message.run.error ?? ''} ${message.run.failure?.message ?? ''}`;
    expect(text).not.toMatch(/watchdog|stream-idle/i);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
