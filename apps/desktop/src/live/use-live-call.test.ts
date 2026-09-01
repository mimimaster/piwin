import { describe, expect, it } from 'vitest';
import { adoptLiveStatus, preferFresherLiveCall } from './live-capabilities.js';
import {
  canStartLive,
  liveMissingLabel,
  liveProviderAuthError,
  liveStartErrorLabel,
  liveStillBoundTargetLabel,
  resolveLiveStartChannel,
} from './use-live-call.js';
import type { LiveCallView } from '@piwin/contracts';

describe('canStartLive', () => {
  it('allows start before status arrives and without a session id', () => {
    expect(
      canStartLive({
        sessionId: null,
        call: null,
        starting: false,
        missing: ['session'],
      }),
    ).toBe(true);
  });

  it('blocks only auth and an existing call', () => {
    expect(
      canStartLive({
        sessionId: 's1',
        call: null,
        starting: false,
        missing: ['provider-auth'],
      }),
    ).toBe(false);
    expect(
      canStartLive({
        sessionId: 's1',
        call: { callId: 'c1' } as never,
        starting: false,
        missing: [],
      }),
    ).toBe(false);
  });

  it('does not treat a leftover Host busy flag as an active call', () => {
    expect(
      canStartLive({
        sessionId: 's1',
        call: null,
        starting: false,
        missing: ['call-busy'],
      }),
    ).toBe(true);
  });
});

describe('liveMissingLabel', () => {
  it('explains session create instead of blocking', () => {
    expect(liveMissingLabel(['session'], true)).toBe('将为当前对话创建会话');
  });
});

describe('liveStartErrorLabel', () => {
  it('maps host auth failure to the current channel', () => {
    expect(liveStartErrorLabel('openai-codex login required for Live', true)).toBe('请先登录 Codex');
    expect(liveStartErrorLabel(liveProviderAuthError('google-gemini'), true)).toBe(
      '请先保存 Gemini API key',
    );
    expect(liveStartErrorLabel('live-provider-auth', true)).toContain('当前 Live 渠道');
  });

  it('refuses to invent a Codex channel when Host status has none', () => {
    expect(resolveLiveStartChannel(null).ok).toBe(false);
  });

  it('derives the Gemini driver when Host status omits mediaDriverId', () => {
    const channel = resolveLiveStartChannel({
      ready: true,
      selectedProviderId: 'google-gemini',
      settingsRevision: 1,
      missing: [],
      call: null,
    });
    expect(channel).toEqual({
      ok: true,
      providerId: 'google-gemini',
      mediaDriverId: 'gemini-live-v1beta',
    });
  });

  it('maps microphone failures', () => {
    expect(liveStartErrorLabel('mic-denied', true)).toContain('麦克风');
    expect(liveStartErrorLabel('mic-unavailable', true)).toContain('麦克风');
  });

  it('maps provider 403 to the upstream rejection copy, not cancelled', () => {
    expect(liveStartErrorLabel('live-provider-access-denied', true)).toContain('上游拒绝');
    expect(liveStartErrorLabel('live-start-cancelled', true)).toContain('已中止');
  });

  it('maps an occupied call to the owning-device hint and other failures to recovery hints', () => {
    expect(liveStartErrorLabel('live-call-busy', true)).toContain('持麦设备');
    expect(liveStartErrorLabel('live-disconnected', true)).toBe('Live 已断开');
    expect(liveStartErrorLabel('live-conflict', true)).toContain('再点一次');
    expect(liveStartErrorLabel('live-start-throttled', true)).toContain('太快');
    expect(liveStartErrorLabel('live-gemini-credits', true)).toContain('额度');
  });

  it('maps rebind ownership and session failures', () => {
    expect(liveStartErrorLabel('live-not-owner', true)).toMatch(/持麦|改绑/);
    expect(liveStartErrorLabel('live-not-owner', false).toLowerCase()).toMatch(/owner|rebind/);
    expect(liveStartErrorLabel('live-session-unavailable', true)).toContain('会话');
  });

  it('explains a kept bind when focus is empty or elsewhere', () => {
    expect(liveStillBoundTargetLabel('Work', true)).toContain('Work');
    expect(liveStillBoundTargetLabel('Work', true)).toMatch(/仍绑定|工作目标/);
    expect(liveStillBoundTargetLabel('Work', false).toLowerCase()).toContain('still bound');
  });
});

describe('preferFresherLiveCall', () => {
  const older: LiveCallView = {
    callId: 'c1',
    revision: 2,
    phase: 'active',
    boundSessionId: 's1',
    boundSessionLabel: 'Work',
    ownerDeviceId: 'local',
    providerId: 'google-gemini',
    mediaDriverId: 'gemini-live-v1beta',
    voiceModelId: 'gemini-live',
    startedAt: '2026-08-29T00:00:00.000Z',
  };

  it('drops Host call-busy so a dead slot cannot look like an active call', () => {
    const adopted = adoptLiveStatus(null, {
      ready: false,
      selectedProviderId: 'google-gemini',
      settingsRevision: 1,
      missing: ['call-busy'],
      call: null,
    });
    expect(adopted.missing).toEqual([]);
    expect(adopted.call).toBeNull();
  });

  it('keeps the locally advanced call when status is stale', () => {
    expect(preferFresherLiveCall(older, { ...older, revision: 1, phase: 'starting' })).toEqual(
      older,
    );
  });
});
