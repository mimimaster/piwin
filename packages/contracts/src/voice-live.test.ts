import { describe, expect, it } from 'vitest';
import {
  LIVE_DELEGATION_INSTRUCTION_MAX_BYTES,
  LIVE_SDP_OFFER_MAX_BYTES,
  isLiveCallErrorCode,
  isLiveMediaDriverId,
  isLiveOwnerEvent,
  validateLiveApplyValues,
  validateLiveSettingFields,
  type LiveCallView,
  type LiveOwnerBootstrap,
  type LiveStartData,
  type LiveStartInput,
  type LiveStatusData,
} from './voice-live.js';

const voiceField = {
  key: 'voice',
  control: 'select' as const,
  label: 'Voice',
  required: true,
  defaultValue: 'cove',
  options: [
    { value: 'cove', label: 'Cove' },
    { value: 'maple', label: 'Maple' },
  ],
};

describe('voice-live contracts', () => {
  it('exposes byte caps', () => {
    expect(LIVE_DELEGATION_INSTRUCTION_MAX_BYTES).toBe(8192);
    expect(LIVE_SDP_OFFER_MAX_BYTES).toBe(256 * 1024);
  });

  it('narrows error codes and driver ids', () => {
    expect(isLiveCallErrorCode('live-provider-auth')).toBe(true);
    expect(isLiveCallErrorCode('live-provider-unavailable')).toBe(true);
    expect(isLiveCallErrorCode('nope')).toBe(false);
    expect(isLiveMediaDriverId('codex-webrtc-v1')).toBe(true);
    expect(isLiveMediaDriverId('openai-realtime-ws-v1')).toBe(true);
    expect(isLiveMediaDriverId('webrtc-sdp')).toBe(false);
  });

  it('status and call view have no secret fields', () => {
    const status: LiveStatusData = {
      ready: false,
      selectedProviderId: 'openai-codex',
      settingsRevision: 1,
      mediaKind: 'webrtc-sdp',
      mediaDriverId: 'codex-webrtc-v1',
      missing: ['provider-auth', 'invalid-settings'],
      call: null,
    };
    const call: LiveCallView = {
      callId: 'c1',
      revision: 1,
      phase: 'active',
      boundSessionId: 's1',
      boundSessionLabel: 'Work',
      ownerDeviceId: 'd1',
      providerId: 'google-gemini',
      mediaDriverId: 'gemini-live-v1beta',
      voiceModelId: 'gemini-3.1-flash-live-preview',
      startedAt: '2026-08-28T00:00:00.000Z',
    };
    expect(JSON.stringify({ status, call })).not.toMatch(
      /"(token|secret|sdpAnswer|offerSdp|authorization|apiKey|ephemeralToken)"/i,
    );
  });

  it('start bootstrap is a discriminant union', () => {
    const start: LiveStartInput = {
      sessionId: 's1',
      providerId: 'openai-codex',
      settingsRevision: 1,
      idempotencyKey: 'k1',
      bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\r\n' },
    };
    const geminiStart: LiveStartInput = {
      sessionId: 's1',
      providerId: 'google-gemini',
      settingsRevision: 1,
      idempotencyKey: 'k2',
      bootstrap: { mediaDriverId: 'gemini-live-v1beta' },
    };
    const data: LiveStartData = {
      call: {
        callId: 'c1',
        revision: 1,
        phase: 'starting',
        boundSessionId: 's1',
        boundSessionLabel: 'Work',
        ownerDeviceId: 'd1',
        providerId: 'openai-codex',
        mediaDriverId: 'codex-webrtc-v1',
        voiceModelId: 'gpt-live-1-codex',
        startedAt: '2026-08-29T00:00:00.000Z',
      },
      bootstrap: { mediaDriverId: 'codex-webrtc-v1', answerSdp: 'v=0\r\n' },
    };
    const geminiBootstrap: LiveOwnerBootstrap = {
      mediaDriverId: 'gemini-live-v1beta',
      endpoint: 'wss://generativelanguage.googleapis.com/ws',
      ephemeralToken: 'ephemeral',
      inputSampleRateHz: 16_000,
      outputSampleRateHz: 24_000,
      modelId: 'gemini-3.1-flash-live-preview',
      voice: 'Kore',
      thinkingLevel: 'minimal',
    };
    const openaiBootstrap: LiveOwnerBootstrap = {
      mediaDriverId: 'openai-realtime-ws-v1',
      endpoint: 'wss://xgrok.planora.chat/v1/realtime?model=grok-voice-think-fast-2.0',
      bearerToken: 'g2a_test',
      inputSampleRateHz: 24_000,
      outputSampleRateHz: 24_000,
      modelId: 'grok-voice-think-fast-2.0',
      voice: 'eve',
    };
    expect(start.bootstrap.mediaDriverId).toBe('codex-webrtc-v1');
    expect(geminiStart.bootstrap.mediaDriverId).toBe('gemini-live-v1beta');
    expect(data.bootstrap.mediaDriverId).toBe('codex-webrtc-v1');
    expect(geminiBootstrap.thinkingLevel).toBe('minimal');
    expect(openaiBootstrap.mediaDriverId).toBe('openai-realtime-ws-v1');
  });

  it('rejects invalid schema defaults and extra apply keys', () => {
    expect(validateLiveSettingFields([{ ...voiceField, defaultValue: 'missing' }]).ok).toBe(false);
    expect(validateLiveApplyValues([voiceField], { voice: 'cove', extra: 'x' }).ok).toBe(false);
    expect(validateLiveApplyValues([voiceField], { voice: 'nope' }).ok).toBe(false);
    expect(validateLiveApplyValues([voiceField], { voice: 'maple' })).toEqual({
      ok: true,
      normalized: { voice: 'maple' },
    });
  });

  it('narrows owner events', () => {
    expect(isLiveOwnerEvent({ type: 'media-active' })).toBe(true);
    expect(isLiveOwnerEvent({ type: 'media-failed', mappedCode: 'live-protocol-failed' })).toBe(true);
    expect(isLiveOwnerEvent({ type: 'peer-failed' })).toBe(false);
    expect(isLiveOwnerEvent({ type: 'delegation', providerDelegationId: 'd1', instruction: 'go' })).toBe(
      true,
    );
  });
});
