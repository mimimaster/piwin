import { describe, expect, it } from 'vitest';
import { createLiveDelegationReviewer } from './index.js';
import { createInitialLiveCallState, transitionLiveCall } from './call-state.js';
import { FakeRealtimeVoiceAdapter } from './fake-realtime-voice-adapter.js';
import { normalizeCodexDelegationCreated } from './codex-delegation.js';
import {
  CodexLiveAdapter,
  CODEX_LIVE_INTELLIGENCE_ENABLED,
  DEFAULT_CODEX_LIVE_INTELLIGENCE,
  DEFAULT_CODEX_LIVE_VOICE,
  buildCodexLiveCallBody,
  buildCodexLiveCallUrl,
  buildCodexLiveRequestHeaders,
  redactLiveLog,
  resolveCodexLiveIntelligence,
  resolveCodexLiveVoice,
} from './codex-live-adapter.js';

describe('public exports', () => {
  it('exports createLiveDelegationReviewer for Host composition', () => {
    expect(typeof createLiveDelegationReviewer).toBe('function');
  });
});

describe('transitionLiveCall', () => {
  it('starts → active → ended', () => {
    let state = createInitialLiveCallState();
    const connected = transitionLiveCall(state, { type: 'connected' });
    expect(connected?.phase).toBe('active');
    state = connected!;
    const ended = transitionLiveCall(state, { type: 'end' });
    expect(ended?.phase).toBe('ended');
    expect(transitionLiveCall(ended!, { type: 'connected' })).toBeNull();
  });

  it('rejects late events after failed', () => {
    let state = createInitialLiveCallState();
    state = transitionLiveCall(state, { type: 'fail', errorCode: 'live-protocol-failed' })!;
    expect(transitionLiveCall(state, { type: 'connected' })).toBeNull();
  });

  it('retargets an active call and clears agent-working', () => {
    let state = createInitialLiveCallState();
    state = transitionLiveCall(state, { type: 'connected' })!;
    state = transitionLiveCall(state, { type: 'set-activity', activity: 'agent-working' })!;
    const next = transitionLiveCall(state, { type: 'retarget' });
    expect(next?.activity).toBe('listening');
    expect(next?.revision).toBe(state.revision + 1);
    expect(transitionLiveCall(next!, { type: 'fail', errorCode: 'live-protocol-failed' })).not.toBeNull();
    const failed = transitionLiveCall(next!, { type: 'fail', errorCode: 'live-protocol-failed' })!;
    expect(transitionLiveCall(failed, { type: 'retarget' })).toBeNull();
  });
});

describe('normalizeCodexDelegationCreated', () => {
  it('accepts client delegation and rejects noise', () => {
    expect(
      normalizeCodexDelegationCreated({
        type: 'delegation.created',
        item: {
          type: 'delegation',
          target: 'client',
          id: 'd1',
          content: [{ type: 'input_text', text: ' ship it ' }],
        },
      }),
    ).toEqual({ providerDelegationId: 'd1', instruction: 'ship it' });
    expect(normalizeCodexDelegationCreated({ type: 'turn.done' })).toBeNull();
  });
});

describe('buildCodexLiveRequestHeaders', () => {
  it('matches the working pi-codex-conversion voice client fingerprint', () => {
    expect(
      buildCodexLiveRequestHeaders({
        accessToken: 't',
        accountId: 'acct',
        sessionId: 's1',
      }),
    ).toMatchObject({
      originator: 'pi',
      'user-agent': 'pi-codex-conversion',
      'chatgpt-account-id': 'acct',
      'x-session-id': 's1',
      'openai-alpha': 'quicksilver=v2',
    });
  });
});

describe('CodexLiveAdapter', () => {
  it('uses the Codex Live v3 voice catalog instead of legacy alloy', () => {
    expect(DEFAULT_CODEX_LIVE_VOICE).toBe('cove');
    expect(resolveCodexLiveVoice(undefined)).toBe('cove');
    expect(resolveCodexLiveVoice('alloy')).toBe('cove');
    expect(resolveCodexLiveVoice(' JUNIPER ')).toBe('juniper');
  });

  it('defaults unknown intelligence to medium', () => {
    expect(DEFAULT_CODEX_LIVE_INTELLIGENCE).toBe('medium');
    expect(resolveCodexLiveIntelligence(undefined)).toBe('medium');
    expect(resolveCodexLiveIntelligence('MAX')).toBe('medium');
    expect(resolveCodexLiveIntelligence(' HIGH ')).toBe('high');
  });

  it('posts Codex backend URL and returns SDP answer', async () => {
    expect(buildCodexLiveCallUrl()).toContain('intent=quicksilver');
    expect(buildCodexLiveCallUrl()).not.toContain('api.openai.com');
    const adapter = new CodexLiveAdapter({
      fetchImpl: async (url, init) => {
        expect(String(url)).toContain('chatgpt.com/backend-api/codex/realtime/calls');
        expect(init?.headers).toMatchObject({
          'openai-alpha': 'quicksilver=v2',
          originator: 'pi',
          'x-session-id': 'session-1',
          'user-agent': 'pi-codex-conversion',
        });
        const body = JSON.parse(String(init?.body)) as { session: Record<string, unknown> };
        expect(body.session.audio).toEqual({ output: { voice: 'cove' } });
        expect(body.session).not.toHaveProperty('intelligence');
        return new Response('v=0\no=- 1 1 IN IP4 0.0.0.0\ns=-\nt=0 0\n', { status: 201 });
      },
    });
    const result = await adapter.createCall({
      sessionId: 'session-1',
      sdpOffer: 'v=0\n',
      accessToken: 't',
      accountId: 'a',
      instructions: 'hi',
      signal: new AbortController().signal,
    });
    expect(result.sdpAnswer).toBe('v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n');
    await adapter.close();
  });

  it('omits session.intelligence after AVAS rejected the field', () => {
    expect(CODEX_LIVE_INTELLIGENCE_ENABLED).toBe(false);
    expect(
      buildCodexLiveCallBody({ sdp: 'v=0', instructions: 'hi', intelligence: 'high' }).session,
    ).not.toHaveProperty('intelligence');
  });

  it('emits developer initial_items only when startup context is present', () => {
    expect(buildCodexLiveCallBody({ sdp: 'v=0', instructions: 'hi' }).session).not.toHaveProperty(
      'initial_items',
    );
    expect(
      buildCodexLiveCallBody({
        sdp: 'v=0',
        instructions: 'hi',
        startupContext: 'Startup context from the bound work session',
      }).session.initial_items,
    ).toEqual([
      {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'Startup context from the bound work session' }],
      },
    ]);
  });

  it('unwraps a JSON SDP answer body', async () => {
    const adapter = new CodexLiveAdapter({
      fetchImpl: async () =>
        new Response(JSON.stringify({ sdp: 'v=0\no=- 1 1 IN IP4 0.0.0.0\ns=-\nt=0 0\n' }), {
          status: 201,
        }),
    });
    const result = await adapter.createCall({
      sessionId: 'session-1',
      sdpOffer: 'v=0\n',
      accessToken: 't',
      accountId: 'a',
      instructions: 'hi',
      signal: new AbortController().signal,
    });
    expect(result.sdpAnswer).toBe('v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n');
    await adapter.close();
  });

  it('maps a 403 create response to provider access denied', async () => {
    const logged: string[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };
    const adapter = new CodexLiveAdapter({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { code: 'forbidden', message: 'Voice session access denied.' } }),
          { status: 403 },
        ),
    });
    try {
      await expect(
        adapter.createCall({
          sessionId: 'session-1',
          sdpOffer: 'v=0\n',
          accessToken: 't',
          accountId: 'a',
          instructions: 'hi',
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('live-provider-access-denied');
      expect(logged.some((line) => line.includes('codex createCall status=403'))).toBe(true);
    } finally {
      console.error = error;
      await adapter.close();
    }
  });

  it('redacts tokens and SDP from Live failure logs', () => {
    expect(redactLiveLog('Bearer abcdefghijklmnop v=0\no=- 1\nsk-abcdefghijklmnopqrstuv')).toBe(
      'Bearer … [sdp]',
    );
  });
});

describe('FakeRealtimeVoiceAdapter', () => {
  it('returns answer and can emit delegation', async () => {
    const adapter = new FakeRealtimeVoiceAdapter({ autoReady: false });
    const events: string[] = [];
    adapter.subscribe((event) => events.push(event.type));
    const result = await adapter.createCall({
      sessionId: 'session-1',
      sdpOffer: 'v=0\n',
      accessToken: 't',
      accountId: 'a',
      instructions: 'hi',
      signal: new AbortController().signal,
    });
    expect(result.sdpAnswer.startsWith('v=')).toBe(true);
    adapter.emitDelegation({ providerDelegationId: 'd1', instruction: 'go' });
    expect(events).toContain('delegation');
    await adapter.close();
    expect(events).toContain('closed');
  });
});
