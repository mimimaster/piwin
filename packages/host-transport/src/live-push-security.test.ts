import { describe, expect, it } from 'vitest';
import type { HostPushVariant, LiveCallView, LiveStatusData } from '@piwin/contracts';
import { classifyHostPush } from './host-push-policy.js';
import { classifyHostPushAudience } from './host-push-audience.js';

const LEAK =
  /authorization|apiKey|ephemeralToken|access_token|AIza|sk-|offerSdp|answerSdp|sdpOffer|sdpAnswer/i;

function liveCall(): LiveCallView {
  return {
    callId: 'c1',
    revision: 1,
    phase: 'active',
    boundSessionId: 's1',
    boundSessionLabel: 'Work',
    ownerDeviceId: 'local',
    providerId: 'openai-codex',
    mediaDriverId: 'codex-webrtc-v1',
    voiceModelId: 'gpt-live-1-codex',
    startedAt: '2026-08-29T00:00:00.000Z',
  };
}

describe('Live push security', () => {
  it('keeps Live pushes off the journal and owner actions owner-scoped', () => {
    const updated: HostPushVariant = { type: 'voice/live-updated', call: liveCall() };
    const action: HostPushVariant = {
      type: 'voice/live-owner-action',
      callId: 'c1',
      action: 'release-media',
    };
    expect(classifyHostPush(updated).journal).toBe(false);
    expect(classifyHostPush(action).journal).toBe(false);
    expect(classifyHostPushAudience(updated)).toEqual({ kind: 'global' });
    expect(classifyHostPushAudience(action)).toEqual({ kind: 'owner' });
  });

  it('serializes status and pushes without SDP, tokens, or API keys', () => {
    const status: LiveStatusData = {
      ready: true,
      selectedProviderId: 'openai-codex',
      settingsRevision: 1,
      mediaKind: 'webrtc-sdp',
      mediaDriverId: 'codex-webrtc-v1',
      missing: [],
      call: liveCall(),
    };
    const updated: HostPushVariant = { type: 'voice/live-updated', call: liveCall() };
    const action: HostPushVariant = {
      type: 'voice/live-owner-action',
      callId: 'c1',
      action: 'append-context',
      content: '晴，大约 24 度。',
    };
    expect(JSON.stringify(status)).not.toMatch(LEAK);
    expect(JSON.stringify(updated)).not.toMatch(LEAK);
    expect(JSON.stringify(action)).not.toMatch(LEAK);
  });
});
