import { describe, expect, it } from 'vitest';
import {
  buildGeminiLiveTokenRequest,
  geminiOwnerBootstrap,
  mintGeminiLiveToken,
  readGeminiAuthTokenError,
} from './gemini-live-adapter.js';
import { GEMINI_LIVE_CONSTRAINED_ENDPOINT, GEMINI_LIVE_VOICES } from './gemini-live-schema.js';
import { createGeminiLiveRegistration } from './gemini-live-registration.js';

describe('Gemini Live adapter', () => {
  it('reads the Google auth_tokens error message without leaking keys', () => {
    expect(
      readGeminiAuthTokenError(
        JSON.stringify({
          error: { message: 'Unknown name "liveConnectConstraints" at \'auth_token\': Cannot find field.' },
        }),
      ),
    ).toContain('liveConnectConstraints');
    expect(readGeminiAuthTokenError('AIzaSynotakey')).toBe('AIzaSynotakey');
  });

  it('locks token uses, model, audio, tool, and compression', () => {
    const body = buildGeminiLiveTokenRequest({
      modelId: 'gemini-3.1-flash-live-preview',
      voice: 'Kore',
      thinkingLevel: 'minimal',
      now: new Date('2026-08-29T00:00:00.000Z'),
    });
    expect(body.uses).toBe(1);
    expect(body).not.toHaveProperty('liveConnectConstraints');
    const setup = body.bidiGenerateContentSetup as {
      model: string;
      generationConfig: { responseModalities: string[] };
      tools: unknown[];
    };
    expect(setup.model).toBe('models/gemini-3.1-flash-live-preview');
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(JSON.stringify(setup.tools)).toContain('delegate_to_work_session');
    expect(JSON.stringify(body)).not.toMatch(/AIza|sk-/);
  });

  it('returns the fixed constrained endpoint', () => {
    const bootstrap = geminiOwnerBootstrap({
      tokenName: 'auth_tokens/abc',
      modelId: 'gemini-3.1-flash-live-preview',
      voice: 'Kore',
      thinkingLevel: 'low',
    });
    expect(bootstrap.mediaDriverId).toBe('gemini-live-v1beta');
    if (bootstrap.mediaDriverId !== 'gemini-live-v1beta') return;
    expect(bootstrap.endpoint).toBe(GEMINI_LIVE_CONSTRAINED_ENDPOINT);
    expect(bootstrap.inputSampleRateHz).toBe(16_000);
    expect(GEMINI_LIVE_VOICES).toContain('Kore');
  });

  it('mints a token without echoing the API key', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      expect(String(init?.headers)).not.toMatch(/sk-secret/);
      expect(JSON.stringify(init?.body)).not.toMatch(/sk-secret/);
      return new Response(JSON.stringify({ name: 'auth_tokens/t1' }), { status: 200 });
    };
    const token = await mintGeminiLiveToken(
      {
        apiKey: 'sk-secret',
        modelId: 'gemini-3.1-flash-live-preview',
        voice: 'Kore',
        thinkingLevel: 'minimal',
        signal: new AbortController().signal,
      },
      fetchImpl,
    );
    expect(token.name).toBe('auth_tokens/t1');
  });

  it('maps a Google 400 on the SDK field name to live-provider-rejected', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'Unknown name "liveConnectConstraints" at \'auth_token\': Cannot find field.',
          },
        }),
        { status: 400 },
      );
    await expect(
      mintGeminiLiveToken(
        {
          apiKey: 'key',
          modelId: 'gemini-3.1-flash-live-preview',
          voice: 'Kore',
          thinkingLevel: 'minimal',
          signal: new AbortController().signal,
        },
        fetchImpl,
      ),
    ).rejects.toThrow('live-provider-rejected');
  });

  it('starts through the registration port', async () => {
    const registration = createGeminiLiveRegistration({
      authReady: async () => true,
      resolveApiKey: async () => 'key',
      fetchImpl: async () => new Response(JSON.stringify({ name: 'auth_tokens/t2' }), { status: 200 }),
    });
    const started = await registration.start({
      callId: 'c1',
      sessionId: 's1',
      settings: {
        model: 'gemini-3.1-flash-live-preview',
        voice: 'Kore',
        thinkingLevel: 'minimal',
      },
      clientBootstrap: { mediaDriverId: 'gemini-live-v1beta' },
      signal: new AbortController().signal,
    });
    expect(started.voiceModelId).toBe('gemini-3.1-flash-live-preview');
    expect(started.ownerBootstrap.mediaDriverId).toBe('gemini-live-v1beta');
  });
});
