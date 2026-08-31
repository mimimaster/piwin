import { describe, expect, it } from 'vitest';
import {
  isLiveOwnerCommand,
  isLocalLiveOwnerConnection,
  liveOwnerCommandRejectedReason,
} from './live-remote-gate.js';

describe('live remote gate', () => {
  it('treats start and mute as owner commands and status as observe-only', () => {
    expect(isLiveOwnerCommand('voice/live/start')).toBe(true);
    expect(isLiveOwnerCommand('voice/live/rebind')).toBe(true);
    expect(isLiveOwnerCommand('voice/live/set-muted')).toBe(true);
    expect(isLiveOwnerCommand('voice/live/status')).toBe(false);
    expect(isLiveOwnerCommand('voice/live/settings-schema')).toBe(false);
    expect(liveOwnerCommandRejectedReason()).toBe('live-not-owner');
  });

  it('admits anonymous loopback or authenticated paired connections as the media owner', () => {
    expect(isLocalLiveOwnerConnection({ loopbackHost: true })).toBe(true);
    expect(isLocalLiveOwnerConnection({ loopbackHost: true, pairedDeviceId: 'phone-1' })).toBe(
      true,
    );
    expect(isLocalLiveOwnerConnection({ loopbackHost: false, pairedDeviceId: 'phone-1' })).toBe(
      true,
    );
    expect(isLocalLiveOwnerConnection({ loopbackHost: false })).toBe(false);
  });
});
