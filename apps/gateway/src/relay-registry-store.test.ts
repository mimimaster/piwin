import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestIdentity } from './relay-harness.fixture.js';
import { loadRelayRegistry, saveRelayRegistry } from './relay-registry-store.js';
import { emptyRelayRegistry, RelayRegistryError } from './relay-user-registry.js';

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-relay-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('relay registry store', () => {
  it('treats a missing file as an empty registry', async () => {
    expect(await loadRelayRegistry(join(await tempDir(), 'users.json'))).toEqual(
      emptyRelayRegistry(),
    );
  });

  it('saves atomically with owner-only permissions and loads it back', async () => {
    const directory = await tempDir();
    const path = join(directory, 'nested', 'users.json');
    const identity = createTestIdentity();
    const state = {
      version: 1 as const,
      users: [
        {
          userId: identity.userId,
          publicKey: identity.userPublicKey,
          name: 'Yorick',
          disabled: false,
        },
      ],
      deniedHosts: [],
    };
    await saveRelayRegistry(path, state);
    expect(await loadRelayRegistry(path)).toEqual(state);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(directory, 'nested'))).toEqual(['users.json']);
    expect((await readFile(path, 'utf8')).endsWith('\n')).toBe(true);
  });

  it('fails loudly on invalid JSON or an invalid document', async () => {
    const directory = await tempDir();
    const path = join(directory, 'users.json');
    await writeFile(path, '{ not json');
    await expect(loadRelayRegistry(path)).rejects.toBeInstanceOf(RelayRegistryError);
    await writeFile(path, JSON.stringify({ version: 9 }));
    await expect(loadRelayRegistry(path)).rejects.toBeInstanceOf(RelayRegistryError);
  });
});
