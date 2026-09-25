import { describe, expect, it, vi } from 'vitest';
import { readHostPairingStatusData, readMobileAccessPairingCodeData } from '@piwin/contracts';
import { HostDevicePairing } from './device-pairing.js';
import {
  HOST_PAIRING_DEVICE_FORBIDDEN_ERROR,
  HOST_PAIRING_DISABLED_ERROR,
  handleHostPairingCommand,
  type HostPairingCommandContext,
} from './host-pairing-commands.js';

function context(overrides: Partial<HostPairingCommandContext> = {}): HostPairingCommandContext {
  return {
    pairing: new HostDevicePairing(),
    store: undefined,
    hostInstanceId: 'host-1',
    bindHost: '127.0.0.1',
    advertisedEndpoint: 'ws://127.0.0.1:8787',
    callerDeviceId: undefined,
    onRevoked: () => undefined,
    ...overrides,
  };
}

function enroll(pairing: HostDevicePairing, name: string): string {
  return pairing.completePairing(pairing.mintToken().token, name).credential.deviceId;
}

describe('handleHostPairingCommand', () => {
  it('reports a Host without a pairing registry as disabled and refuses to mint', async () => {
    const ctx = context({ pairing: undefined });
    const status = await handleHostPairingCommand({ type: 'host/pairing-status' }, ctx);
    expect(readHostPairingStatusData(status.success ? status.data : undefined)).toEqual({
      enabled: false,
      canManage: false,
      pairedDeviceCount: 0,
      hostInstanceId: 'host-1',
    });
    const minted = await handleHostPairingCommand({ type: 'host/pairing-create-code' }, ctx);
    expect(minted).toMatchObject({ success: false, error: HOST_PAIRING_DISABLED_ERROR });
  });

  it('lets an operator mint a code for the advertised endpoint, list and revoke', async () => {
    const pairing = new HostDevicePairing();
    const deviceId = enroll(pairing, 'iPhone');
    const onRevoked = vi.fn();
    const ctx = context({ pairing, advertisedEndpoint: 'wss://mac.tailnet.ts.net:8787', onRevoked });

    const status = await handleHostPairingCommand({ type: 'host/pairing-status' }, ctx);
    expect(status.success ? status.data : undefined).toMatchObject({
      enabled: true,
      canManage: true,
      pairedDeviceCount: 1,
      advertisedEndpoint: 'wss://mac.tailnet.ts.net:8787',
    });

    const minted = await handleHostPairingCommand({ type: 'host/pairing-create-code' }, ctx);
    const code = readMobileAccessPairingCodeData(minted.success ? minted.data : undefined);
    expect(code?.endpoint).toBe('wss://mac.tailnet.ts.net:8787');
    expect(code?.hostInstanceId).toBe('host-1');

    const listed = await handleHostPairingCommand({ type: 'host/pairing-list-devices' }, ctx);
    expect(listed.success ? listed.data : undefined).toMatchObject({
      devices: [{ id: deviceId, name: 'iPhone', revoked: false }],
    });

    const revoked = await handleHostPairingCommand(
      { type: 'host/pairing-revoke-device', deviceId },
      ctx,
    );
    expect(revoked).toMatchObject({ success: true, data: { revoked: true } });
    expect(onRevoked).toHaveBeenCalledWith(deviceId);
  });

  it('never lets a paired device mint codes or revoke devices', async () => {
    const pairing = new HostDevicePairing();
    const deviceId = enroll(pairing, 'iPhone');
    const ctx = context({ pairing, callerDeviceId: deviceId });

    const status = await handleHostPairingCommand({ type: 'host/pairing-status' }, ctx);
    expect(status.success ? status.data : undefined).toMatchObject({ enabled: true, canManage: false });
    for (const command of [
      { type: 'host/pairing-create-code' as const },
      { type: 'host/pairing-list-devices' as const },
      { type: 'host/pairing-revoke-device' as const, deviceId },
    ]) {
      const response = await handleHostPairingCommand(command, ctx);
      expect(response).toMatchObject({ success: false, error: HOST_PAIRING_DEVICE_FORBIDDEN_ERROR });
    }
    expect(pairing.list()[0]?.revokedAt).toBeUndefined();
  });

  it('rejects a revoke without a device id and a wildcard bind QR', async () => {
    const empty = await handleHostPairingCommand(
      { type: 'host/pairing-revoke-device', deviceId: '  ' },
      context(),
    );
    expect(empty.success).toBe(false);
    const wildcard = await handleHostPairingCommand(
      { type: 'host/pairing-create-code' },
      context({ bindHost: '0.0.0.0' }),
    );
    expect(wildcard).toMatchObject({ success: false, error: expect.stringContaining('wildcard') });
  });
});
