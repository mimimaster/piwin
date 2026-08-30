import { describe, expect, it } from 'vitest';
import type { LiveCallView, LiveStatusData } from '@piwin/contracts';
import { adoptLiveStatus } from './mobile-live-state.js';

const call: LiveCallView = {
  callId: 'call-1',
  revision: 2,
  phase: 'active',
  boundSessionId: 'session-1',
  boundSessionLabel: '工作',
  ownerDeviceId: 'mobile-1',
  providerId: 'openai-codex',
  mediaDriverId: 'codex-webrtc-v1',
  voiceModelId: 'gpt-live-1-codex',
  startedAt: '2026-08-29T00:00:00.000Z',
};

function status(nextCall: LiveCallView | null): LiveStatusData {
  return {
    ready: true,
    selectedProviderId: 'openai-codex',
    settingsRevision: 1,
    missing: ['call-busy'],
    call: nextCall,
  };
}

describe('mobile Live state', () => {
  it('keeps a newer local revision when a stale status response arrives', () => {
    expect(adoptLiveStatus(status(call), status({ ...call, revision: 1 })).call).toEqual(call);
  });

  it('removes call-busy from the shell readiness view', () => {
    expect(adoptLiveStatus(null, status(null)).missing).toEqual([]);
  });
});
