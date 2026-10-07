import { describe, expect, it, vi } from 'vitest';
import type { LiveCallView } from '@piwin/contracts';
import { applyLiveSystemControl, projectLiveSystemActivity } from './live-system-activity.js';

const call: LiveCallView = {
  callId: 'call-1', revision: 3, phase: 'active', activity: 'listening',
  boundSessionId: 'session-2', boundSessionLabel: 'Current work', ownerDeviceId: 'phone',
  providerId: 'openai-realtime', mediaDriverId: 'openai-realtime-ws-v1',
  voiceModelId: 'grok-voice-latest', startedAt: '2026-10-07T08:00:00Z',
};

describe('Live system activity', () => {
  it('projects only safe owned media state and clears cards on media loss', () => {
    const projected = projectLiveSystemActivity(call, { phase: 'connected', muted: false, errorCode: null });
    expect(projected).toEqual({ callId: 'call-1', sessionId: 'session-2', sessionLabel: 'Current work',
      startedAt: call.startedAt, phase: 'active', activity: 'listening', muted: false });
    expect(projectLiveSystemActivity(call, { phase: 'idle', muted: false, errorCode: null })).toBeNull();
    expect(projectLiveSystemActivity(call, { phase: 'error', muted: false, errorCode: 'peer-failed' })).toBeNull();
    expect(projectLiveSystemActivity(null, { phase: 'connected', muted: false, errorCode: null })).toBeNull();
  });

  it('does not present an incomplete handshake as listening and preserves mute', () => {
    expect(projectLiveSystemActivity(call, { phase: 'negotiating', muted: false, errorCode: null })?.phase).toBe('starting');
    expect(projectLiveSystemActivity(call, { phase: 'connected', muted: true, errorCode: null })?.activity).toBe('muted');
    expect(projectLiveSystemActivity({ ...call, boundSessionLabel: 'x'.repeat(500) },
      { phase: 'connected', muted: false, errorCode: null })?.sessionLabel).toHaveLength(80);
  });

  it('rejects old card actions, routes controls to the current owner, and opens the current binding', async () => {
    const handlers = { setMuted: vi.fn(async () => undefined), end: vi.fn(async () => undefined), openSession: vi.fn() };
    await applyLiveSystemControl({ call, muted: false, control: { callId: 'old', action: 'end' }, ...handlers });
    expect(handlers.end).not.toHaveBeenCalled();
    await applyLiveSystemControl({ call, muted: true, control: { callId: call.callId, action: 'toggle-muted' }, ...handlers });
    expect(handlers.setMuted).toHaveBeenCalledWith(false);
    await applyLiveSystemControl({ call, muted: false, control: { callId: call.callId, action: 'open-session' }, ...handlers });
    expect(handlers.openSession).toHaveBeenCalledWith('session-2');
    await applyLiveSystemControl({ call, muted: false, control: { callId: call.callId, action: 'end' }, ...handlers });
    expect(handlers.end).toHaveBeenCalledOnce();
  });
});
