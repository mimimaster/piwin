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

  it('allows an operator to dynamically toggle pairing on and off', async () => {
    let enabledState = false;
    let endpointState: string | undefined = 'ws://127.0.0.1:8787';
    const setEnabled = vi.fn((enabled: boolean, endpoint?: string) => {
      enabledState = enabled;
      if (endpoint) endpointState = endpoint;
    });
    const ctx = context({
      pairing: new HostDevicePairing(),
      pairingEnabled: false,
      setEnabled,
      advertisedEndpoint: endpointState,
    });

    const initialStatus = await handleHostPairingCommand({ type: 'host/pairing-status' }, ctx);
    expect(initialStatus.success ? initialStatus.data : undefined).toMatchObject({
      enabled: false,
      canManage: true,
    });

    const enableResponse = await handleHostPairingCommand(
      { type: 'host/pairing-set-enabled', enabled: true, advertisedEndpoint: 'wss://tailscale.net:8787' },
      ctx,
    );
    expect(enableResponse).toMatchObject({
      success: true,
      data: { enabled: true, canManage: true, advertisedEndpoint: 'wss://tailscale.net:8787' },
    });
    expect(setEnabled).toHaveBeenCalledWith(true, 'wss://tailscale.net:8787');

    const disableResponse = await handleHostPairingCommand(
      { type: 'host/pairing-set-enabled', enabled: false },
      ctx,
    );
    expect(disableResponse).toMatchObject({
      success: true,
      data: { enabled: false, canManage: true },
    });
    expect(setEnabled).toHaveBeenCalledWith(false, undefined);
  });

  it('rejects a revoke without a device id and a wildcard QR endpoint', async () => {
    const empty = await handleHostPairingCommand(
      { type: 'host/pairing-revoke-device', deviceId: '  ' },
      context(),
    );
    expect(empty.success).toBe(false);
    const wildcard = await handleHostPairingCommand(
      { type: 'host/pairing-create-code' },
      context({ advertisedEndpoint: 'ws://0.0.0.0:8787' }),
    );
    expect(wildcard).toMatchObject({ success: false, error: expect.stringContaining('wildcard') });
    const concrete = await handleHostPairingCommand(
      { type: 'host/pairing-create-code', advertisedEndpoint: 'ws://192.168.1.5:8787' },
      context({ advertisedEndpoint: 'ws://0.0.0.0:8787' }),
    );
    expect(concrete.success).toBe(true);
  });
});
