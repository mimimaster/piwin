import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexProvider } from './codex-provider.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('codexProvider.discover', () => {
  it('lists pets under the codex pets dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-codex-'));
    const codexPetsDir = join(root, 'codex-pets');
    const dir = join(codexPetsDir, 'codex-pet');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'pet.json'),
      JSON.stringify({ id: 'codex-pet', displayName: 'Codex', spritesheetPath: 's.png' }),
    );
    await writeFile(join(dir, 's.png'), PNG_MAGIC);
    const ctx = { piwinRoot: root, petsDir: join(root, 'pets'), codexPetsDir };
    const entries = await codexProvider.discover(ctx);
    expect(entries.map((e) => e.petId)).toEqual(['codex-pet']);
    expect(entries[0]?.source).toBe('codex-live');
    expect(entries[0]?.installed).toBe(true);
  });

  it('returns empty when codex dir is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-codex-'));
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'missing-codex'),
    };
    const entries = await codexProvider.discover(ctx);
    expect(entries).toEqual([]);
  });
});
