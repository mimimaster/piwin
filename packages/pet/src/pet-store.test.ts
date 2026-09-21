import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deletePet,
  getActivePet,
  installPetFromLocalPath,
  installPetFromLocalPaths,
  loadPetPreference,
  savePetPreference,
  setActivePet,
} from './pet-store.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function seedPet(parent: string, petId: string): Promise<string> {
  const packagePath = join(parent, petId);
  await mkdir(packagePath, { recursive: true });
  await writeFile(
    join(packagePath, 'pet.json'),
    JSON.stringify({ id: petId, displayName: petId, spritesheetPath: 'sheet.png' }),
  );
  await writeFile(join(packagePath, 'sheet.png'), PNG_MAGIC);
  return packagePath;
}

describe('installPetFromLocalPaths', () => {
  it('continues importing after one package fails', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-pet-batch-root-'));
    const staging = await mkdtemp(join(tmpdir(), 'piwin-pet-batch-stage-'));
    const first = await seedPet(staging, 'first-pet');
    const second = await seedPet(staging, 'second-pet');

    const result = await installPetFromLocalPaths(piwinRoot, [
      first,
      join(staging, 'missing-pet'),
      second,
      first,
    ]);

    expect(result.installed.map((pet) => pet.petId)).toEqual(['first-pet', 'second-pet']);
    expect(result.failed).toEqual([
      {
        sourcePath: join(staging, 'missing-pet'),
        error: expect.stringContaining('ENOENT'),
      },
    ]);
  });
});

describe('pet preference without a bundled default', () => {
  it('does not invent piwin-default when nothing is saved', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-pet-pref-'));
    await savePetPreference(piwinRoot, { activePetId: '' });
    const preference = await loadPetPreference(piwinRoot);
    expect(preference.activePetId).toBe('');
  });

  it('throws from getActivePet when the preferred pet is missing', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-pet-missing-'));
    await savePetPreference(piwinRoot, { activePetId: 'does-not-exist' });
    await expect(getActivePet(piwinRoot)).rejects.toThrow();
  });

  it('clears the active preference when the last local pet is deleted', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-pet-delete-root-'));
    const staging = await mkdtemp(join(tmpdir(), 'piwin-pet-delete-stage-'));
    const source = await seedPet(staging, 'only-pet');
    await installPetFromLocalPath(piwinRoot, source);
    await setActivePet(piwinRoot, 'only-pet');

    const result = await deletePet(piwinRoot, 'only-pet');
    expect(result.fallbackPet).toBeUndefined();
    expect((await loadPetPreference(piwinRoot)).activePetId).toBe('');
    await expect(getActivePet(piwinRoot)).rejects.toThrow('no active pet');
  });
});
