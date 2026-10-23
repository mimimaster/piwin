import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSecretResolver } from './secret-resolver.js';
import {
  createWindowsCredentialStore,
  WINDOWS_CREDENTIAL_MAX_CHARS,
  type RunPowerShell,
  type WindowsCredentialStore,
} from './windows-credential-store.js';

/** In-memory Credential Manager behind the same PowerShell contract. */
function fakePowerShell(): {
  run: RunPowerShell;
  vault: Map<string, string>;
  calls: Parameters<RunPowerShell>[0][];
} {
  const vault = new Map<string, string>();
  const calls: Parameters<RunPowerShell>[0][] = [];
  const run: RunPowerShell = async (input) => {
    calls.push(input);
    const target = input.env.PIWIN_CREDENTIAL_TARGET ?? '';
    switch (input.env.PIWIN_CREDENTIAL_OP) {
      case 'read': {
        const value = vault.get(target);
        return value === undefined
          ? { exitCode: 3, stdout: '', stderr: '' }
          : { exitCode: 0, stdout: value, stderr: '' };
      }
      case 'write':
        vault.set(target, input.stdin);
        return { exitCode: 0, stdout: '', stderr: '' };
      case 'delete':
        vault.delete(target);
        return { exitCode: 0, stdout: '', stderr: '' };
      default:
        return { exitCode: 1, stdout: '', stderr: 'unknown op' };
    }
  };
  return { run, vault, calls };
}

describe('createWindowsCredentialStore', () => {
  it('passes the secret on stdin only and namespaces the target', async () => {
    const shell = fakePowerShell();
    const store = createWindowsCredentialStore(shell.run);
    await store.write('piwin-openai', 'sk-secret');
    expect(shell.vault.get('piwin:piwin-openai')).toBe('sk-secret');
    const writeCall = shell.calls[0];
    expect(writeCall?.stdin).toBe('sk-secret');
    expect(JSON.stringify(writeCall?.env)).not.toContain('sk-secret');
    expect(writeCall?.script).not.toContain('sk-secret');
    expect(await store.read('piwin-openai')).toBe('sk-secret');
    await store.delete('piwin-openai');
    expect(await store.read('piwin-openai')).toBeNull();
  });

  it('maps a missing credential to null and other failures to an error without the secret', async () => {
    const failing: RunPowerShell = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Exception calling "Write": Access is denied\r\nAt line:1',
    });
    const store = createWindowsCredentialStore(failing);
    await expect(store.write('svc', 'top-secret')).rejects.toThrow(
      /Windows Credential Manager write failed for svc \(exit 1\): Exception calling "Write": Access is denied$/,
    );
    await expect(store.write('svc', 'x'.repeat(WINDOWS_CREDENTIAL_MAX_CHARS + 1))).rejects.toThrow(
      /at most 1280 characters/,
    );
  });
});

describe('secret resolver on Windows', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function makeRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'piwin-win-secrets-'));
    roots.push(root);
    return root;
  }

  it('writes to Credential Manager, not the plaintext file store', async () => {
    const root = await makeRoot();
    const shell = fakePowerShell();
    const resolver = createSecretResolver({
      piwinRoot: root,
      platform: 'win32',
      windowsStore: createWindowsCredentialStore(shell.run),
    });
    const ref = await resolver.writeProviderSecret('openai', 'sk-live');
    expect(ref).toBe('keychain:piwin-openai');
    expect(shell.vault.get('piwin:piwin-openai')).toBe('sk-live');
    await expect(readFile(join(root, 'secrets', 'piwin-openai'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await resolver.readSecretByRef(ref)).toBe('sk-live');
  });

  it('moves a plaintext file secret into Credential Manager on first read', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'secrets'), { recursive: true });
    await writeFile(join(root, 'secrets', 'piwin-openai'), 'sk-from-file\n');
    const shell = fakePowerShell();
    const resolver = createSecretResolver({
      piwinRoot: root,
      platform: 'win32',
      windowsStore: createWindowsCredentialStore(shell.run),
    });
    expect(await resolver.readProviderSecret('openai')).toBe('sk-from-file');
    expect(shell.vault.get('piwin:piwin-openai')).toBe('sk-from-file');
    await expect(readFile(join(root, 'secrets', 'piwin-openai'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('caches reads and keeps the file when Credential Manager refuses the write', async () => {
    const root = await makeRoot();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const read = vi.fn<WindowsCredentialStore['read']>(async () => null);
    const store: WindowsCredentialStore = {
      read,
      write: async () => {
        throw new Error('Windows Credential Manager write failed for piwin-openai (exit 1)');
      },
      delete: async () => undefined,
    };
    const resolver = createSecretResolver({
      piwinRoot: root,
      platform: 'win32',
      windowsStore: store,
    });
    await resolver.writeProviderSecret('openai', 'sk-kept');
    expect(await readFile(join(root, 'secrets', 'piwin-openai'), 'utf8')).toBe('sk-kept');
    expect(await resolver.readProviderSecret('openai')).toBe('sk-kept');
    expect(await resolver.readProviderSecret('openai')).toBe('sk-kept');
    expect(read).not.toHaveBeenCalled();
    await resolver.deleteProviderSecret('openai');
    expect(await resolver.readProviderSecret('openai')).toBeNull();
  });
});

// Real Credential Manager round trip; runs only on Windows (CI windows job).
describe.runIf(process.platform === 'win32')('Windows Credential Manager (live)', () => {
  it('writes, reads, and deletes a generic credential', async () => {
    const store = createWindowsCredentialStore();
    const service = `piwin-ci-${process.pid}-${Date.now()}`;
    try {
      await store.write(service, 'value with spaces and ünïcode');
      expect(await store.read(service)).toBe('value with spaces and ünïcode');
    } finally {
      await store.delete(service);
    }
    expect(await store.read(service)).toBeNull();
  }, 60_000);
});
