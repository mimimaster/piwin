import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPetSourceRegistry,
  discoverAllPets,
} from './pet-source-registry.js';
import { bundledProvider } from './sources/bundled-provider.js';
import { localProvider } from './sources/local-provider.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('discoverAllPets', () => {
  it('dedupes by petId with priority order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-reg-test-'));
    const petsDir = join(root, 'pets');
    await mkdir(petsDir, { recursive: true });
    // Both bundled and local expose a pet with id 'shared'.
    const bundledDir = join(root, 'pet', 'bundled', 'shared');
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      join(bundledDir, 'pet.json'),
      JSON.stringify({ id: 'shared', displayName: 'Bundled Shared', spritesheetPath: 's.png' }),
    );
    await writeFile(join(bundledDir, 's.png'), PNG);
    const localDir = join(petsDir, 'shared');
    await mkdir(localDir, { recursive: true });
    await writeFile(
      join(localDir, 'pet.json'),
      JSON.stringify({ id: 'shared', displayName: 'Local Shared', spritesheetPath: 's.png' }),
    );
    await writeFile(join(localDir, 's.png'), PNG);
    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      bundledRoot: join(root, 'pet', 'bundled'),
    };
    const registry = createPetSourceRegistry([bundledProvider, localProvider]);
    const entries = await discoverAllPets(registry, ctx);
    const shared = entries.find((e) => e.petId === 'shared');
    expect(shared?.source).toBe('bundled');
    expect(shared?.displayName).toBe('Bundled Shared');
  });

  it('isolates provider failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-reg-test-'));
    const failing = {
      kind: 'bundled' as const,
      discover: vi.fn(async () => {
        throw new Error('boom');
      }),
      resolve: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const ok = {
      kind: 'local' as const,
      discover: vi.fn(async () => [
        {
          petId: 'ok-pet',
          displayName: 'OK',
          source: 'local' as const,
          location: '/x',
          installed: true,
          issues: [],
        },
      ]),
      resolve: vi.fn(async () => {
        throw new Error('no');
      }),
    };
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'codex'),
    };
    const registry = createPetSourceRegistry([failing, ok]);
    const entries = await discoverAllPets(registry, ctx);
    expect(entries.map((e) => e.petId)).toEqual(['ok-pet']);
  });
});
