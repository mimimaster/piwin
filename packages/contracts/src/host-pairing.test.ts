import { describe, expect, it } from 'vitest';
import { isHostPairingCommand, readHostPairingStatusData } from './host-pairing.js';

describe('host pairing contracts', () => {
  it('accepts the four pairing commands and validates the revoke target', () => {
    expect(isHostPairingCommand({ type: 'host/pairing-status' })).toBe(true);
    expect(isHostPairingCommand({ type: 'host/pairing-create-code' })).toBe(true);
    expect(isHostPairingCommand({ type: 'host/pairing-list-devices' })).toBe(true);
    expect(isHostPairingCommand({ type: 'host/pairing-revoke-device', deviceId: 'd1' })).toBe(true);
    expect(isHostPairingCommand({ type: 'host/pairing-revoke-device', deviceId: ' ' })).toBe(false);
    expect(isHostPairingCommand({ type: 'host/pairing-revoke-device', deviceId: 'x'.repeat(257) })).toBe(
      false,
    );
    expect(isHostPairingCommand({ type: 'mobile-access/start' })).toBe(false);
  });

  it('reads status and drops an empty advertised endpoint', () => {
    expect(
      readHostPairingStatusData({
        enabled: true,
        canManage: true,
        pairedDeviceCount: 2,
        hostInstanceId: 'h',
        advertisedEndpoint: '',
      }),
    ).toEqual({ enabled: true, canManage: true, pairedDeviceCount: 2, hostInstanceId: 'h' });
    expect(readHostPairingStatusData({ enabled: true })).toBeUndefined();
  });
});
