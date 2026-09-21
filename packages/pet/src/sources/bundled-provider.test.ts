import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledProvider } from './bundled-provider.js';

async function makeTempPiwinRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-pet-bundled-'));
  return root;
}

async function seedBundled(root: string, petId: string): Promise<void> {
  // The provider reads from <root>/pet/bundled/<petId> to mirror the
  // resolveBundledAssetsRoot layout used in production.
  const dir = join(root, 'pet', 'bundled', petId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'pet.json'),
    JSON.stringify({
      id: petId,
      displayName: petId,
      spritesheetPath: 'sheet.png',
    }),
  );
  await writeFile(join(dir, 'sheet.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

describe('bundledProvider.discover', () => {
  it('lists bundled pets under pet/bundled', async () => {
    const root = await makeTempPiwinRoot();
    await seedBundled(root, 'piwin-default');
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'codex-pets'),
      bundledRoot: join(root, 'pet', 'bundled'),
    };
    const entries = await bundledProvider.discover(ctx);
    expect(entries.map((e) => e.petId)).toContain('piwin-default');
    expect(entries[0]?.source).toBe('bundled');
    expect(entries[0]?.installed).toBe(false);
  });

  it('returns empty list when bundled dir is missing', async () => {
    const root = await makeTempPiwinRoot();
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'codex-pets'),
      bundledRoot: join(root, 'pet', 'bundled'),
    };
    const entries = await bundledProvider.discover(ctx);
    expect(entries).toEqual([]);
  });

  it('ships no pet packages in the package bundled directory', async () => {
    const bundledRoot = join(dirname(fileURLToPath(import.meta.url)), '../../bundled');
    const names = await readdir(bundledRoot);
    const petIds: string[] = [];
    for (const name of names) {
      const dir = join(bundledRoot, name);
      try {
        if (!(await stat(dir)).isDirectory()) continue;
      } catch {
        continue;
      }
      try {
        await stat(join(dir, 'pet.json'));
        petIds.push(name);
      } catch {
        // README / empty placeholders are allowed.
      }
    }
    expect(petIds).toEqual([]);
  });
});
