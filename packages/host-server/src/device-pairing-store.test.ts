import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostDevicePairing } from './device-pairing.js';
import { HostDevicePairingFileStore } from './device-pairing-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-pairing-store-'));
  temporaryDirectories.push(directory);
  return join(directory, 'devices', 'pairing.json');
}

describe('HostDevicePairingFileStore', () => {
  it('round-trips trusted devices and pending token hashes atomically', async () => {
    const filePath = await createStorePath();
    const pairing = new HostDevicePairing();
    const token = pairing.mintToken();
    const completion = pairing.completePairing(token.token, 'iPhone', 'client-phone');
    const pendingToken = pairing.mintToken();
    const store = new HostDevicePairingFileStore(filePath);

    await store.save(pairing);
    await store.flush();

    const serialized = await readFile(filePath, 'utf8');
    expect(serialized).not.toContain(completion.credential.deviceSecret);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    const restored = new HostDevicePairing();
    await store.load(restored);
    expect(restored.authenticate(completion.credential)).toMatchObject({
      id: completion.device.id,
      name: 'iPhone',
      clientId: 'client-phone',
    });
    const pendingCompletion = restored.completePairing(pendingToken.token, 'Second iPhone');
    expect(restored.authenticate(pendingCompletion.credential)).toMatchObject({
      name: 'Second iPhone',
    });
  });

  it('rejects malformed snapshots before replacing state', async () => {
    const filePath = await createStorePath();
    const store = new HostDevicePairingFileStore(filePath);
    const pairing = new HostDevicePairing();
    const completion = pairing.completePairing(pairing.mintToken().token, 'Keep me');
    await store.save(pairing);

    await writeFile(filePath, '{not-json', 'utf8');
    await expect(store.load(pairing)).rejects.toThrow('parse paired-device store');
    expect(pairing.authenticate(completion.credential)).toMatchObject({ id: completion.device.id });
  });
});
