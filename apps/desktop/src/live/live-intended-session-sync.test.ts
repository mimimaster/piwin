import { describe, expect, it, vi } from 'vitest';
import { syncLiveIntendedSession } from './live-intended-session-sync.js';

describe('syncLiveIntendedSession', () => {
  it('does nothing without a callId', async () => {
    const request = vi.fn();
    await syncLiveIntendedSession({
      hostClient: { request } as never,
      callId: null,
      intendedSessionId: 'session-b',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('sends null when focus is empty', async () => {
    const request = vi.fn(async () => ({ success: true }));
    await syncLiveIntendedSession({
      hostClient: { request } as never,
      callId: 'live_176f3215',
      intendedSessionId: null,
    });
    expect(request).toHaveBeenCalledWith({
      type: 'voice/live/set-intended-session',
      input: { callId: 'live_176f3215', intendedSessionId: null },
    });
  });

  it('sends the focused session id', async () => {
    const request = vi.fn(async () => ({ success: true }));
    await syncLiveIntendedSession({
      hostClient: { request } as never,
      callId: 'call-1',
      intendedSessionId: 'session-mtieiifb-87z4rhfp',
    });
    expect(request).toHaveBeenCalledWith({
      type: 'voice/live/set-intended-session',
      input: {
        callId: 'call-1',
        intendedSessionId: 'session-mtieiifb-87z4rhfp',
      },
    });
  });
});
