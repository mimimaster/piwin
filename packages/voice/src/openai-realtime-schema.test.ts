import { describe, expect, it } from 'vitest';
import {
  encodeOpenaiRealtimeRouteId,
  httpBaseUrlToRealtimeWs,
  modelLooksRealtimeAudio,
  openaiRealtimeLiveSettingFields,
  parseOpenaiRealtimeRouteId,
  validateOpenaiRealtimeLiveSettings,
} from './openai-realtime-schema.js';
import { openaiRealtimeOwnerBootstrap } from './openai-realtime-adapter.js';
import { createOpenaiRealtimeLiveRegistration } from './openai-realtime-registration.js';

const route = {
  routeId: encodeOpenaiRealtimeRouteId('custom-openai-2', 'grok-voice-think-fast-2.0'),
  providerId: 'custom-openai-2',
  providerName: 'xgrok',
  modelId: 'grok-voice-think-fast-2.0',
  modelLabel: 'grok-voice-think-fast-2.0',
  baseUrl: 'https://xgrok.planora.chat/v1',
};

describe('openai realtime live schema', () => {
  it('encodes and parses route ids', () => {
    expect(parseOpenaiRealtimeRouteId(route.routeId)).toEqual({
      providerId: 'custom-openai-2',
      modelId: 'grok-voice-think-fast-2.0',
    });
  });

  it('treats grok-voice and OpenAI realtime ids as realtime without the capability tag', () => {
    expect(modelLooksRealtimeAudio({ id: 'grok-voice-think-fast-2.0' })).toBe(true);
    expect(modelLooksRealtimeAudio({ id: 'gpt-4o-realtime-preview' })).toBe(true);
    expect(modelLooksRealtimeAudio({ id: 'grok-4.6' })).toBe(false);
    expect(
      modelLooksRealtimeAudio({ id: 'rt-1', capabilities: ['realtime-audio'] }),
    ).toBe(true);
  });

  it('builds a wss realtime endpoint from an https baseUrl', () => {
    expect(httpBaseUrlToRealtimeWs(route.baseUrl, route.modelId)).toBe(
      'wss://xgrok.planora.chat/v1/realtime?model=grok-voice-think-fast-2.0',
    );
  });

  it('validates settings against configured routes', () => {
    const fields = openaiRealtimeLiveSettingFields([route]);
    expect(fields[0]?.options[0]?.value).toBe(route.routeId);
    expect(
      validateOpenaiRealtimeLiveSettings(
        { route: route.routeId, voice: 'eve' },
        [route],
      ).ok,
    ).toBe(true);
  });
});

describe('openai realtime registration', () => {
  it('starts with bearer bootstrap from the provider key', async () => {
    const registration = createOpenaiRealtimeLiveRegistration({
      listRoutes: () => [route],
      resolveApiKey: async () => 'g2a_test',
      fetchImpl: async () => new Response('404', { status: 404 }),
    });
    const started = await registration.start({
      callId: 'c1',
      sessionId: 's1',
      settings: { route: route.routeId, voice: 'eve' },
      clientBootstrap: { mediaDriverId: 'openai-realtime-ws-v1' },
      signal: new AbortController().signal,
    });
    expect(started.voiceModelId).toBe(route.modelId);
    expect(started.ownerBootstrap).toEqual(
      openaiRealtimeOwnerBootstrap({
        baseUrl: route.baseUrl,
        bearerToken: 'g2a_test',
        modelId: route.modelId,
        voice: 'eve',
      }),
    );
  });
});
