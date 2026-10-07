import { describe, expect, it, vi } from 'vitest';
import type { HostClient } from '@piwin/host-client';
import {
  attachDeviceHealth,
  getDeviceHealthSnapshot,
  setDeviceHealthUseMode,
} from './device-health.js';

describe('device health outside the mobile shell', () => {
  it('never touches the Host client and reports Apple Health as unavailable', () => {
    const subscribeState = vi.fn();
    const client = { subscribeState, getHostHello: vi.fn() } as unknown as HostClient;

    const detach = attachDeviceHealth(client, 'ws://127.0.0.1:8787');

    expect(subscribeState).not.toHaveBeenCalled();
    expect(getDeviceHealthSnapshot()).toMatchObject({
      status: 'detached',
      available: false,
      connected: false,
      enabled: false,
      consentRequest: undefined,
    });
    // No runtime is attached, so preference changes have nothing to act on.
    setDeviceHealthUseMode('always-allow-this-host');
    expect(getDeviceHealthSnapshot().useMode).toBe('ask-every-time');
    detach();
  });
});
