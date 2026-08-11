import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPetFromLocalPaths } from './pet-store.js';

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
