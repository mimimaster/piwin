import { describe, expect, it } from 'vitest';
import { planLiveOwnerEvent } from './live-owner-event-plan.js';

describe('planLiveOwnerEvent', () => {
  it('routes a delegation to the controller without touching call state', () => {
    expect(
      planLiveOwnerEvent({ type: 'delegation', providerDelegationId: 'd1', instruction: '修一下' }),
    ).toEqual({ kind: 'delegate', providerDelegationId: 'd1', instruction: '修一下' });
  });

  it('maps activity and media progress to non-terminal transitions', () => {
    expect(planLiveOwnerEvent({ type: 'activity', activity: 'user-speaking' })).toEqual({
      kind: 'transition',
      transition: { type: 'set-activity', activity: 'user-speaking' },
    });
    expect(planLiveOwnerEvent({ type: 'media-active' })).toEqual({
      kind: 'transition',
      transition: { type: 'connected' },
    });
    expect(planLiveOwnerEvent({ type: 'media-reconnecting' })).toEqual({
      kind: 'transition',
      transition: { type: 'reconnect' },
    });
  });

  it('terminates on media failure and keeps the provider error code', () => {
    expect(
      planLiveOwnerEvent({ type: 'media-failed', mappedCode: 'live-provider-auth' }),
    ).toEqual({
      kind: 'terminate',
      transition: { type: 'fail', errorCode: 'live-provider-auth' },
    });
  });

  it('falls back to a protocol failure when the shell reports no code', () => {
    expect(planLiveOwnerEvent({ type: 'media-failed' })).toEqual({
      kind: 'terminate',
      transition: { type: 'fail', errorCode: 'live-protocol-failed' },
    });
  });

  it('treats a closed media surface as the end of the call', () => {
    expect(planLiveOwnerEvent({ type: 'media-closed' })).toEqual({
      kind: 'terminate',
      transition: { type: 'end' },
    });
  });
});