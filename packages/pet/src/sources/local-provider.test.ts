import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localProvider } from './local-provider.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function makeRoot(): Promise<{ root: string; petsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-pet-local-'));
  const petsDir = join(root, 'pets');
  await mkdir(petsDir, { recursive: true });
  return { root, petsDir };
}

async function seedPet(parent: string, petId: string): Promise<string> {
  const dir = join(parent, petId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'pet.json'),
    JSON.stringify({ id: petId, displayName: petId, spritesheetPath: 'sheet.png' }),
  );
  await writeFile(join(dir, 'sheet.png'), PNG_MAGIC);
  return dir;
}

describe('localProvider.discover', () => {
  it('lists pets under ~/.piwin/pets', async () => {
    const { root, petsDir } = await makeRoot();
    await seedPet(petsDir, 'my-pet');
    const ctx = { piwinRoot: root, petsDir, codexPetsDir: join(root, 'codex') };
    const entries = await localProvider.discover(ctx);
    expect(entries.map((e) => e.petId)).toEqual(['my-pet']);
    expect(entries[0]?.source).toBe('local');
    expect(entries[0]?.installed).toBe(true);
  });
});

describe('localProvider.install', () => {
  it('copies a source directory into petsDir', async () => {
    const { root, petsDir } = await makeRoot();
    const staging = await mkdtemp(join(tmpdir(), 'piwin-pet-stage-'));
    const sourceDir = await seedPet(staging, 'imported-pet');
    const ctx = { piwinRoot: root, petsDir, codexPetsDir: join(root, 'codex') };
    const result = await localProvider.install!(ctx, sourceDir);
    expect(result.petId).toBe('imported-pet');
    expect(result.source).toBe('local');
    expect(result.path).toBe(join(petsDir, 'imported-pet'));
  });

  it('rejects a missing spritesheet', async () => {
    const { root, petsDir } = await makeRoot();
    const staging = await mkdtemp(join(tmpdir(), 'piwin-pet-stage-'));
    const dir = join(staging, 'bad-pet');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'pet.json'),
      JSON.stringify({ id: 'bad-pet', displayName: 'bad', spritesheetPath: 'sheet.png' }),
    );
    const ctx = { piwinRoot: root, petsDir, codexPetsDir: join(root, 'codex') };
    await expect(localProvider.install!(ctx, dir)).rejects.toThrow(/spritesheet/);
  });
});
