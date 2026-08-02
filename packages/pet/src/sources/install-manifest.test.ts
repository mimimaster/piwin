import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fetchInstallManifest,
  installPetFromSlug,
  isPetSlug,
  INSTALL_MANIFEST_SCHEMA,
} from './install-manifest.js';

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Minimal valid PNG (1×1). */
function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

describe('isPetSlug', () => {
  it('accepts codex-style slugs', () => {
    expect(isPetSlug('blankie')).toBe(true);
    expect(isPetSlug('round-puff-pink')).toBe(true);
    expect(isPetSlug('Tiny_Dino')).toBe(true);
  });

  it('rejects paths and urls', () => {
    expect(isPetSlug('../evil')).toBe(false);
    expect(isPetSlug('https://x.com/a')).toBe(false);
    expect(isPetSlug('')).toBe(false);
  });
});

describe('fetchInstallManifest + installPetFromSlug', () => {
  it('downloads pet.json + spritesheet with per-file sha256', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-slug-'));
    const petJson = Buffer.from(
      JSON.stringify({
        id: 'blankie',
        displayName: 'Blankie',
        spritesheetPath: 'spritesheet.webp',
      }),
      'utf8',
    );
    const sheet = tinyPng();
    const manifest = {
      schema_version: INSTALL_MANIFEST_SCHEMA,
      pet: { slug: 'blankie', display_name: 'Blankie' },
      files: [
        {
          role: 'pet_json',
          path: 'pet.json',
          url: 'https://codexpethub.com/assets/pets/blankie/pet.json',
          size: petJson.byteLength,
          sha256: sha256Hex(petJson),
        },
        {
          role: 'spritesheet',
          path: 'spritesheet.webp',
          url: 'https://codexpethub.com/assets/pets/blankie/sheet.webp',
          size: sheet.byteLength,
          sha256: sha256Hex(sheet),
        },
      ],
      security: {
        allowed_install_files: ['pet.json', 'spritesheet.webp'],
        verify_hashes_required: true,
      },
    };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('install-manifest.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => manifest,
          body: null,
        };
      }
      if (url.endsWith('pet.json')) {
        return {
          ok: true,
          status: 200,
          body: (async function* () {
            yield new Uint8Array(petJson);
          })(),
        };
      }
      if (url.endsWith('sheet.webp')) {
        return {
          ok: true,
          status: 200,
          body: (async function* () {
            yield new Uint8Array(sheet);
          })(),
        };
      }
      return { ok: false, status: 404, body: null };
    });

    try {
      const result = await installPetFromSlug(
        {
          piwinRoot: root,
          petsDir: join(root, 'pets'),
          codexPetsDir: join(root, 'codex'),
        },
        'blankie',
        { fetch: fetchMock as never },
      );
      expect(result.petId).toBe('blankie');
      expect(result.source).toBe('registry');
      const installed = JSON.parse(
        await readFile(join(result.path, 'pet.json'), 'utf8'),
      ) as { id: string };
      expect(installed.id).toBe('blankie');
      await readFile(join(result.path, 'spritesheet.webp'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects sha256 mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-slug-bad-'));
    const petJson = Buffer.from(
      JSON.stringify({
        id: 'x',
        displayName: 'X',
        spritesheetPath: 'spritesheet.webp',
      }),
      'utf8',
    );
    const sheet = tinyPng();
    const manifest = {
      schema_version: INSTALL_MANIFEST_SCHEMA,
      pet: { slug: 'x' },
      files: [
        {
          role: 'pet_json',
          path: 'pet.json',
          url: 'https://codexpethub.com/assets/x/pet.json',
          size: petJson.byteLength,
          sha256: sha256Hex(petJson),
        },
        {
          role: 'spritesheet',
          path: 'spritesheet.webp',
          url: 'https://codexpethub.com/assets/x/sheet.webp',
          size: sheet.byteLength,
          sha256: '0'.repeat(64),
        },
      ],
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('install-manifest')) {
        return { ok: true, status: 200, json: async () => manifest, body: null };
      }
      const body = url.endsWith('pet.json') ? petJson : sheet;
      return {
        ok: true,
        status: 200,
        body: (async function* () {
          yield new Uint8Array(body);
        })(),
      };
    });
    try {
      await expect(
        installPetFromSlug(
          {
            piwinRoot: root,
            petsDir: join(root, 'pets'),
            codexPetsDir: join(root, 'codex'),
          },
          'x',
          { fetch: fetchMock as never },
        ),
      ).rejects.toThrow(/sha256 mismatch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fetchInstallManifest rejects bad schema', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ schema_version: 'nope', pet: { slug: 'a' }, files: [] }),
    }));
    await expect(
      fetchInstallManifest('blankie', { fetch: fetchMock as never }),
    ).rejects.toThrow(/schema/);
  });
});
