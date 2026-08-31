import { describe, expect, it } from 'vitest';
import {
  LiveProviderRegistry,
  createCodexLiveRegistration,
  createGeminiLiveRegistration,
} from '@piwin/voice';
import { LiveCallCoordinator } from './live-call-coordinator.js';
import { createVoiceDelegationAdmission } from './voice-delegation-admission.js';
import type { LiveChannelSnapshot } from './live-settings-service.js';

function geminiSnapshot(overrides?: Partial<LiveChannelSnapshot>): LiveChannelSnapshot {
  return {
    revision: 3,
    selectedProviderId: 'google-gemini',
    values: {
      model: 'gemini-3.1-flash-live-preview',
      voice: 'Kore',
      thinkingLevel: 'minimal',
    },
    registered: true,
    authReady: true,
    settingsValid: true,
    mediaKind: 'pcm-websocket',
    mediaDriverId: 'gemini-live-v1beta',
    ...overrides,
  };
}

describe('Gemini Live start without Codex', () => {
  it('mints a constrained token and returns Gemini bootstrap while Codex is logged out', async () => {
    const registry = new LiveProviderRegistry([
      createCodexLiveRegistration({
        authReady: async () => false,
        resolveAuth: async () => null,
      }),
      createGeminiLiveRegistration({
        authReady: async () => true,
        resolveApiKey: async () => 'ai-studio-key',
        fetchImpl: async () =>
          new Response(JSON.stringify({ name: 'auth_tokens/flow-1' }), { status: 200 }),
      }),
    ]);
    const coordinator = new LiveCallCoordinator({
      review: async (request) => ({ kind: 'work', brief: request.instruction }),
      registry,
      resolveSnapshot: async (providerId) => {
        if (providerId === 'openai-codex') {
          return geminiSnapshot({
            selectedProviderId: 'openai-codex',
            authReady: false,
            mediaKind: 'webrtc-sdp',
            mediaDriverId: 'codex-webrtc-v1',
            values: { voice: 'cove' },
          });
        }
        return geminiSnapshot();
      },
      resolveSessionLabel: () => 'Work',
      admission: createVoiceDelegationAdmission({
        busy: { isSessionBusy: () => false },
        prompt: {
          admitVoiceDelegation: async () => ({
            queued: false,
            runId: 'r1',
            messageId: 'm1',
          }),
        },
      }),
    });

    const started = await coordinator.start({
      sessionId: 's1',
      providerId: 'google-gemini',
      settingsRevision: 3,
      idempotencyKey: 'gemini-no-codex',
      bootstrap: { mediaDriverId: 'gemini-live-v1beta' },
      ownerDeviceId: 'local',
      signal: new AbortController().signal,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.call.providerId).toBe('google-gemini');
    expect(started.call.mediaDriverId).toBe('gemini-live-v1beta');
    expect(started.bootstrap.mediaDriverId).toBe('gemini-live-v1beta');
    if (started.bootstrap.mediaDriverId === 'gemini-live-v1beta') {
      expect(started.bootstrap.ephemeralToken).toBe('auth_tokens/flow-1');
    }
    await coordinator.dispose();
  });
});
