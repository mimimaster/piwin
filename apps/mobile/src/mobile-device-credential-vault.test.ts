import { describe, expect, it } from 'vitest';
import {
  createMemoryMobileDeviceCredentialVault,
  createMobileDeviceCredentialVault,
  createTauriMobileDeviceCredentialVault,
  readMobileDeviceCredential,
} from './mobile-device-credential-vault.js';

describe('mobile device credential vault', () => {
  it('stores a secret in memory without touching localStorage', async () => {
    const vault = createMemoryMobileDeviceCredentialVault();
    const credential = { deviceId: 'device-1', deviceSecret: 'secret' };
    await vault.write('ws://127.0.0.1:8787', credential);
    await expect(vault.read(' ws://127.0.0.1:8787 ')).resolves.toEqual(credential);
    expect(globalThis.localStorage?.getItem('ws://127.0.0.1:8787') ?? null).toBeNull();
    await vault.clear('ws://127.0.0.1:8787');
    await expect(vault.read('ws://127.0.0.1:8787')).resolves.toBeUndefined();
  });

  it('uses an in-memory vault outside Tauri', () => {
    expect(createMobileDeviceCredentialVault()).toEqual(expect.objectContaining({
      read: expect.any(Function),
      write: expect.any(Function),
      clear: expect.any(Function),
    }));
  });

  it('reads JSON from the native command and ignores malformed payloads', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    const vault = createTauriMobileDeviceCredentialVault(async (command, args) => {
      calls.push({ command, args });
      if (command === 'mobile_credential_read') {
        return JSON.stringify({ deviceId: 'device-1', deviceSecret: 'secret' });
      }
      return undefined;
    });
    await expect(vault.read('ws://host')).resolves.toEqual({
      deviceId: 'device-1',
      deviceSecret: 'secret',
    });
    await vault.write('ws://host', { deviceId: 'device-1', deviceSecret: 'secret' });
    expect(calls[1]?.command).toBe('mobile_credential_write');
    expect(String(calls[1]?.args.payload)).not.toContain('localStorage');

    const broken = createTauriMobileDeviceCredentialVault(async () => '{not-json');
    await expect(broken.read('ws://host')).resolves.toBeUndefined();
  });

  it('continues without a stored credential when the native store rejects', async () => {
    const unavailable = createTauriMobileDeviceCredentialVault(async () => {
      throw new Error('keychain unavailable');
    });

    await expect(readMobileDeviceCredential(unavailable, 'ws://host')).resolves.toBeUndefined();
  });
});
