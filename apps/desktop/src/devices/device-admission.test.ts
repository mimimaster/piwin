import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryDeviceCredentialVault } from '@piwin/host-client';
import {
  forgetDeviceCredential,
  peekDeviceCredential,
  primeDeviceCredential,
  rememberDeviceCredential,
  selectAdmissionKey,
  setDeviceCredentialVaultForTesting,
} from './device-admission.js';

const ENDPOINT = 'ws://192.168.1.20:8790';
const CREDENTIAL = { deviceId: 'device-1', deviceSecret: 'secret' };

describe('device admission', () => {
  afterEach(() => {
    setDeviceCredentialVaultForTesting(undefined);
  });

  it('has nothing to present until the stored credential is primed', async () => {
    const vault = createMemoryDeviceCredentialVault();
    await vault.write(ENDPOINT, CREDENTIAL);
    setDeviceCredentialVaultForTesting(vault);

    expect(peekDeviceCredential(ENDPOINT)).toBeUndefined();
    await primeDeviceCredential(` ${ENDPOINT} `);
    expect(peekDeviceCredential(ENDPOINT)).toEqual(CREDENTIAL);
  });

  it('keeps an issued credential for this process and writes it to the vault', async () => {
    const vault = createMemoryDeviceCredentialVault();
    setDeviceCredentialVaultForTesting(vault);

    await rememberDeviceCredential(ENDPOINT, CREDENTIAL);
    expect(peekDeviceCredential(ENDPOINT)).toEqual(CREDENTIAL);
    await expect(vault.read(ENDPOINT)).resolves.toEqual(CREDENTIAL);
  });

  it('still serves the live session when the vault write fails', async () => {
    setDeviceCredentialVaultForTesting({
      read: async () => undefined,
      write: async () => {
        throw new Error('keychain locked');
      },
      clear: async () => undefined,
    });

    await expect(rememberDeviceCredential(ENDPOINT, CREDENTIAL)).rejects.toThrow('keychain locked');
    expect(peekDeviceCredential(ENDPOINT)).toEqual(CREDENTIAL);
  });

  it('drops a credential the vault no longer holds', async () => {
    const vault = createMemoryDeviceCredentialVault();
    setDeviceCredentialVaultForTesting(vault);
    await rememberDeviceCredential(ENDPOINT, CREDENTIAL);

    await forgetDeviceCredential(ENDPOINT);
    expect(peekDeviceCredential(ENDPOINT)).toBeUndefined();
    await primeDeviceCredential(ENDPOINT);
    expect(peekDeviceCredential(ENDPOINT)).toBeUndefined();
  });

  it('presents one admission key, freshest proof first', () => {
    const deviceCredential = { deviceId: 'device-1', deviceSecret: 'secret-1' };
    expect(
      selectAdmissionKey({ pairingToken: ' pair ', deviceCredential, authToken: 'door' }),
    ).toEqual({ kind: 'pairing-token', pairingToken: 'pair' });
    expect(selectAdmissionKey({ pairingToken: ' ', deviceCredential, authToken: 'door' })).toEqual({
      kind: 'device-credential',
      deviceCredential,
    });
    expect(selectAdmissionKey({ authToken: ' door ' })).toEqual({
      kind: 'auth-token',
      authToken: 'door',
    });
    expect(selectAdmissionKey({ authToken: '' })).toBeUndefined();
  });
});
