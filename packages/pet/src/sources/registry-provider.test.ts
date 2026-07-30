import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registryProvider } from './registry-provider.js';

describe('registryProvider.queryStore', () => {
  it('returns parsed catalog entries from the registry url', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-reg-'));
    const catalog = [
      {
        id: 'remote-1',
        displayName: 'Remote One',
        url: 'https://reg.test/remote-1.zip',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
      },
    ];
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => catalog,
    }));
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'codex'),
      registryUrl: 'https://reg.test/catalog.json',
      fetch: fetchMock as never,
    };
    const results = await registryProvider.queryStore!(ctx as never, '');
    expect(results.map((r) => r.petId)).toEqual(['remote-1']);
    expect(results[0]?.source).toBe('registry');
    expect(fetchMock).toHaveBeenCalledWith('https://reg.test/catalog.json', {
      redirect: 'follow',
    });
  });

  it('marks already-installed pets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-reg-'));
    const petsDir = join(root, 'pets');
    const installed = join(petsDir, 'remote-1');
    await mkdir(installed, { recursive: true });
    await writeFile(
      join(installed, 'pet.json'),
      JSON.stringify({ id: 'remote-1', displayName: 'x', spritesheetPath: 's.png' }),
    );
    const catalog = [
      {
        id: 'remote-1',
        displayName: 'Remote One',
        url: 'https://reg.test/remote-1.zip',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
      },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => catalog,
    }));
    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      registryUrl: 'https://reg.test/catalog.json',
      fetch: fetchMock as never,
    };
    const results = await registryProvider.queryStore!(ctx as never, '');
    expect(results[0]?.installed).toBe(true);
  });
});
