import { describe, expect, it } from 'vitest';
import type { HostClientHello, HostHello } from './remote-protocol.js';
import { isTrustedDeviceCredential } from './remote.js';

describe('remote pairing contracts', () => {
  it('accepts a well-formed device credential', () => {
    expect(
      isTrustedDeviceCredential({
        deviceId: 'device-1',
        deviceSecret: 'secret',
      }),
    ).toBe(true);
  });

  it('rejects empty or partial credentials', () => {
    expect(isTrustedDeviceCredential({ deviceId: 'device-1' })).toBe(false);
    expect(isTrustedDeviceCredential({ deviceId: '  ', deviceSecret: 'secret' })).toBe(false);
    expect(isTrustedDeviceCredential(null)).toBe(false);
  });

  it('keeps pairing fields additive on hello frames', () => {
    const clientHello: HostClientHello = {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: '0.0.0',
      clientId: 'phone-1',
      lastSeq: 0,
      pairingToken: 'one-time',
      deviceName: 'iPhone',
    };
    const hostHello: HostHello = {
      type: 'host/hello',
      protocolVersion: 1,
      hostInstanceId: 'host-1',
      currentSeq: 0,
      authRequired: true,
      authenticated: true,
      capabilities: {
        pushSequencing: true,
        replay: true,
        snapshot: true,
        sessionRead: true,
        sessionControl: true,
        permissionResolve: true,
        mediaUpload: true,
      },
      deviceId: 'device-1',
      deviceSecret: 'issued-once',
    };
    expect(clientHello.pairingToken).toBe('one-time');
    expect(hostHello.deviceSecret).toBe('issued-once');
  });
});
