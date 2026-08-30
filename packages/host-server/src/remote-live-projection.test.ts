import { describe, expect, it } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import { projectRemoteLiveResponse } from './remote-live-projection.js';

describe('projectRemoteLiveResponse', () => {
  it('keeps start bootstrap for the local owner', () => {
    const response: HostResponse = {
      type: 'response',
      command: 'voice/live/start',
      success: true,
      data: {
        call: {
          callId: 'c1',
          revision: 1,
          phase: 'starting',
          boundSessionId: 's1',
          boundSessionLabel: 'Work',
          ownerDeviceId: 'local',
          providerId: 'google-gemini',
          mediaDriverId: 'gemini-live-v1beta',
          voiceModelId: 'gemini-live',
          startedAt: '2026-08-29T00:00:00.000Z',
        },
        bootstrap: {
          mediaDriverId: 'gemini-live-v1beta',
          endpoint:
            'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained',
          ephemeralToken: 'auth_tokens/abc',
          inputSampleRateHz: 16_000,
          outputSampleRateHz: 24_000,
          modelId: 'gemini-live',
          voice: 'Puck',
          thinkingLevel: 'minimal',
        },
      },
    };
    const projected = projectRemoteLiveResponse(
      {
        type: 'voice/live/start',
        input: {
          sessionId: 's1',
          providerId: 'google-gemini',
          settingsRevision: 1,
          idempotencyKey: 'k1',
          bootstrap: { mediaDriverId: 'gemini-live-v1beta' },
        },
      },
      response,
      { owner: true },
    );
    expect(projected).toEqual(response);
  });

  it('strips start bootstrap so remote never sees SDP or tokens', () => {
    const projected = projectRemoteLiveResponse(
      {
        type: 'voice/live/start',
        input: {
          sessionId: 's1',
          providerId: 'openai-codex',
          settingsRevision: 1,
          idempotencyKey: 'k1',
          bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\nsecret' },
        },
      },
      {
        type: 'response',
        command: 'voice/live/start',
        success: true,
        data: {
          call: {
            callId: 'c1',
            revision: 1,
            phase: 'starting',
            boundSessionId: 's1',
            boundSessionLabel: 'Work',
            ownerDeviceId: 'local',
            providerId: 'openai-codex',
            mediaDriverId: 'codex-webrtc-v1',
            voiceModelId: 'gpt-live-1-codex',
            startedAt: '2026-08-29T00:00:00.000Z',
          },
          bootstrap: {
            mediaDriverId: 'codex-webrtc-v1',
            answerSdp: 'v=0\nsecret-answer',
          },
        },
      },
    );
    expect(projected?.success).toBe(true);
    expect(JSON.stringify(projected)).not.toMatch(/answerSdp|secret-answer|offerSdp|v=0/i);
  });

  it('redacts token query values from Live errors', () => {
    const projected = projectRemoteLiveResponse(
      { type: 'voice/live/status', input: { capabilities: { microphone: true, mediaDriverIds: [] } } },
      {
        type: 'response',
        command: 'voice/live/status',
        success: false,
        error: 'ws failed https://example.test/ws?access_token=tokensecret',
      },
    );
    expect(projected?.success).toBe(false);
    expect(projected && 'error' in projected ? projected.error : '').not.toContain('tokensecret');
  });
});
