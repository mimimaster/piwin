import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanLocalPetPackages } from './local-import.js';

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

describe('scanLocalPetPackages', () => {
  it('scans direct child package directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-scan-'));
    await seedPet(root, 'architect-alpaca');
    await mkdir(join(root, 'not-a-pet'));

    const preview = await scanLocalPetPackages(root);

    expect(preview.sourcePath).toBe(root);
    expect(preview.candidates.map((candidate) => candidate.petId)).toEqual(['architect-alpaca']);
    expect(preview.candidates[0]?.valid).toBe(true);
  });

  it('treats a concrete package directory as a one-item preview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-scan-'));
    const packagePath = await seedPet(root, 'single-pet');

    const preview = await scanLocalPetPackages(packagePath);

    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]?.sourcePath).toBe(packagePath);
    expect(preview.candidates[0]?.valid).toBe(true);
  });

  it('includes invalid packages with actionable issues', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-scan-'));
    const packagePath = join(root, 'broken-pet');
    await mkdir(packagePath, { recursive: true });
    await writeFile(
      join(packagePath, 'pet.json'),
      JSON.stringify({ id: 'broken-pet', displayName: 'Broken Pet', spritesheetPath: 'sheet.png' }),
    );

    const preview = await scanLocalPetPackages(root);

    expect(preview.candidates[0]?.valid).toBe(false);
    expect(preview.candidates[0]?.issues).toContain('missing spritesheet: sheet.png');
  });
});
