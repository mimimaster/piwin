import { describe, expect, it } from 'vitest';
import { createInitialLiveCallState, transitionLiveCall } from './call-state.js';
import { FakeRealtimeVoiceAdapter } from './fake-realtime-voice-adapter.js';
import { normalizeCodexDelegationCreated } from './codex-delegation.js';
import {
  CodexLiveAdapter,
  DEFAULT_CODEX_LIVE_VOICE,
  buildCodexLiveCallUrl,
  buildCodexLiveRequestHeaders,
  resolveCodexLiveVoice,
} from './codex-live-adapter.js';

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
        expect(JSON.parse(String(init?.body))).toMatchObject({
          session: { audio: { output: { voice: 'cove' } } },
        });
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
    const adapter = new CodexLiveAdapter({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { code: 'forbidden', message: 'Voice session access denied.' } }),
          { status: 403 },
        ),
    });
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
    await adapter.close();
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
