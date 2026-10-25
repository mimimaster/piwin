import { encodeBase64Url, generateNoiseKeyPair } from '@piwin/host-transport';
import { describe, expect, it } from 'vitest';
import { deviceRoleOf, DevicePairingError, HostDevicePairing } from './device-pairing.js';
import { listPairedDevices } from './pairing-operations.js';

const channelKey = (): string => encodeBase64Url(generateNoiseKeyPair().publicKey);

/** Golden cases for ADR 0101 §4–§5 admission state in the pairing authority. */
describe('HostDevicePairing channel binding and roles', () => {
  it('binds the handshake key at channel pairing and requires it afterwards', () => {
    const pairing = new HostDevicePairing();
    const key = channelKey();
    const { token } = pairing.mintToken();
    const { credential, device } = pairing.completePairing(token, 'Phone', 'install-1', key);
    expect(device.channelPublicKey).toBe(key);
    expect(deviceRoleOf(device)).toBe('member');
    expect(pairing.authenticate(credential, 'install-1', key)?.id).toBe(credential.deviceId);
    expect(pairing.authenticate(credential, 'install-1', channelKey())).toBeUndefined();
  });

  it('refuses an unmigrated device on the channel but still admits it on the legacy path', () => {
    const pairing = new HostDevicePairing();
    const { credential } = pairing.completePairing(pairing.mintToken().token, 'Old phone');
    expect(pairing.authenticate(credential, undefined, channelKey())).toBeUndefined();
    expect(pairing.authenticate(credential)?.id).toBe(credential.deviceId);
  });

  it('carries the minted role into the device record and the persisted state', () => {
    const pairing = new HostDevicePairing();
    const { token } = pairing.mintToken('operator');
    expect(pairing.exportState().pending[0]?.role).toBe('operator');
    const { device } = pairing.completePairing(token, 'Laptop', 'install-2', channelKey());
    expect(deviceRoleOf(device)).toBe('operator');

    const restored = new HostDevicePairing();
    restored.restoreState(pairing.exportState());
    expect(deviceRoleOf(restored.list()[0] ?? {})).toBe('operator');
    expect(listPairedDevices({ pairing: restored, store: undefined })[0]).toMatchObject({
      role: 'operator',
      secureChannel: true,
    });
  });

  it('restores a pending operator code across a restart', () => {
    const pairing = new HostDevicePairing();
    const { token } = pairing.mintToken('operator');
    const restored = new HostDevicePairing();
    restored.restoreState(pairing.exportState());
    expect(deviceRoleOf(restored.completePairing(token).device)).toBe('operator');
  });

  it('migrates a legacy device once: bound, idempotent, conflicting key refused', () => {
    const pairing = new HostDevicePairing({ now: () => Date.parse('2026-10-25T00:00:00Z') });
    const { credential } = pairing.completePairing(pairing.mintToken().token);
    const key = channelKey();
    expect(pairing.bindChannelKey(credential.deviceId, key)).toBe('bound');
    expect(pairing.list()[0]?.migratedAt).toBe('2026-10-25T00:00:00.000Z');
    expect(pairing.bindChannelKey(credential.deviceId, key)).toBe('already-bound');
    expect(pairing.bindChannelKey(credential.deviceId, channelKey())).toBe('conflict');
    expect(pairing.authenticate(credential, undefined, key)?.id).toBe(credential.deviceId);
  });

  it('does not bind revoked or unknown devices, nor malformed keys', () => {
    const pairing = new HostDevicePairing();
    const { credential } = pairing.completePairing(pairing.mintToken().token);
    pairing.revoke(credential.deviceId);
    expect(pairing.bindChannelKey(credential.deviceId, channelKey())).toBe('unknown');
    expect(pairing.bindChannelKey('device-missing', channelKey())).toBe('unknown');
    expect(() => pairing.bindChannelKey(credential.deviceId, 'not-a-key')).toThrow();
    expect(() =>
      pairing.completePairing(pairing.mintToken().token, 'x', 'y', 'not-a-key'),
    ).toThrow();
  });

  it('enrolls a migrating token-door caller as an operator and dedupes by installation', () => {
    const pairing = new HostDevicePairing();
    const key = channelKey();
    const first = pairing.enrollMigratedOperator({
      clientId: 'shell-1',
      channelPublicKey: key,
      deviceName: 'Mac',
    });
    expect(deviceRoleOf(first.device)).toBe('operator');
    expect(first.device.migratedAt).toBe(first.device.createdAt);
    const again = pairing.enrollMigratedOperator({ clientId: 'shell-1', channelPublicKey: key });
    expect(pairing.list()).toHaveLength(1);
    expect(pairing.authenticate(first.credential, undefined, key)).toBeUndefined();
    expect(pairing.authenticate(again.credential, undefined, key)?.id).toBe(
      again.credential.deviceId,
    );
  });

  it('finds active devices by channel key and reports pending codes for early drop', () => {
    const pairing = new HostDevicePairing();
    expect(pairing.hasPendingTokens()).toBe(false);
    const { token } = pairing.mintToken();
    expect(pairing.hasPendingTokens()).toBe(true);
    const key = channelKey();
    const { credential } = pairing.completePairing(token, 'Phone', undefined, key);
    expect(pairing.hasPendingTokens()).toBe(false);
    expect(pairing.findByChannelKey(key)?.id).toBe(credential.deviceId);
    pairing.revoke(credential.deviceId);
    expect(pairing.findByChannelKey(key)).toBeUndefined();
  });

  it('expires pending codes for early drop like it does for enrollment', () => {
    let now = 0;
    const pairing = new HostDevicePairing({ now: () => now, tokenTtlMs: 1_000 });
    const { token } = pairing.mintToken();
    now = 1_000;
    expect(pairing.hasPendingTokens()).toBe(false);
    expect(() => pairing.completePairing(token)).toThrow(DevicePairingError);
  });

  it('rejects persisted state with a malformed channel key or role', () => {
    const pairing = new HostDevicePairing();
    const { device } = pairing.completePairing(pairing.mintToken().token);
    const state = pairing.exportState();
    expect(() =>
      new HostDevicePairing().restoreState({
        ...state,
        devices: [{ ...device, channelPublicKey: 'bad' }],
      }),
    ).toThrow();
    expect(() =>
      new HostDevicePairing().restoreState({ ...state, devices: [{ ...device, role: 'root' }] }),
    ).toThrow();
  });
});
