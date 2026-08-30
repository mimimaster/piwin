import { describe, expect, it } from 'vitest';
import { computeLiveReadiness } from './live-call-readiness.js';

const capabilities = {
  microphone: true,
  mediaDriverIds: ['codex-webrtc-v1' as const],
};

describe('computeLiveReadiness', () => {
  it('is ready when every gate passes', () => {
    expect(
      computeLiveReadiness({
        selectedProviderId: 'openai-codex',
        mediaKind: 'webrtc-sdp',
        mediaDriverId: 'codex-webrtc-v1',
        providerRegistered: true,
        authReady: true,
        settingsValid: true,
        sessionReady: true,
        callBusy: false,
        capabilities,
      }),
    ).toEqual({ ready: true, missing: [] });
  });

  it('lists each missing gate', () => {
    const result = computeLiveReadiness({
      selectedProviderId: 'google-gemini',
      mediaDriverId: 'gemini-live-v1beta',
      providerRegistered: false,
      authReady: false,
      settingsValid: false,
      sessionReady: false,
      callBusy: true,
      capabilities: { microphone: false, mediaDriverIds: ['codex-webrtc-v1'] },
    });
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([
      'provider-unavailable',
      'provider-auth',
      'invalid-settings',
      'microphone',
      'media-unsupported',
      'session',
      'call-busy',
    ]);
  });
});
