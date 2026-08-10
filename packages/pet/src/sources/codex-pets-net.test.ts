import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fetchCodexPetsNetDetail,
  installPetFromCodexPetsNet,
  resolveCodexPetsNetDownloadUrl,
  CODEX_PETS_NET_ORIGIN,
} from './codex-pets-net.js';

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

/** Build a real zip body using Buffer + zip magic header + stored file entries.
 * This is a minimal zip with pet.json + spritesheet.webp. */
function buildZipBody(): Buffer {
  // We can't easily build a real zip without a dep. The mock unzip writes
  // files directly, so the zip body only needs ZIP magic + padding to pass
  // downloadAndVerifyPackage's magic check.
  const magic = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const padding = Buffer.alloc(64, 0);
  return Buffer.concat([magic, padding]);
}

describe('resolveCodexPetsNetDownloadUrl', () => {
  it('prefers pet.downloadUrl (live share-data shape)', () => {
    expect(
      resolveCodexPetsNetDownloadUrl(
        {
          pet: { id: 'clawd', downloadUrl: '/api/pets/clawd/download?v=1' },
        },
        'clawd',
      ),
    ).toBe('/api/pets/clawd/download?v=1');
  });

  it('accepts top-level downloadUrl for legacy mocks', () => {
    expect(
      resolveCodexPetsNetDownloadUrl(
        {
          pet: { id: 'x' },
          downloadUrl: '/api/pets/x/download',
        },
        'x',
      ),
    ).toBe('/api/pets/x/download');
  });

  it('falls back to /api/pets/{slug}/download', () => {
    expect(
      resolveCodexPetsNetDownloadUrl({ pet: { id: 'clawd' } }, 'clawd'),
    ).toBe('/api/pets/clawd/download');
  });
});

describe('fetchCodexPetsNetDetail', () => {
  it('fetches share-data and reads nested pet fields', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/share-data')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            pet: {
              id: 'clawd',
              displayName: 'Clawd',
              downloadUrl: '/api/pets/clawd/download?v=1777707802295',
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const detail = await fetchCodexPetsNetDetail('clawd', {
      fetch: fetchMock as never,
    });
    expect(detail.pet.id).toBe('clawd');
    expect(detail.pet.downloadUrl).toContain('clawd');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/share-data');
  });

  it('falls back to /api/pets/{slug} when share-data 404s', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/share-data')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          pet: { id: 'yijian', downloadUrl: '/api/pets/yijian/download?v=1' },
        }),
      };
    });
    const detail = await fetchCodexPetsNetDetail('yijian', {
      fetch: fetchMock as never,
    });
    expect(detail.pet.id).toBe('yijian');
  });

  it('rejects invalid slug', async () => {
    await expect(
      fetchCodexPetsNetDetail('../evil', { fetch: vi.fn() as never }),
    ).rejects.toThrow(/slug/);
  });
});

describe('installPetFromCodexPetsNet', () => {
  it('downloads zip, extracts, validates, and installs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-cpn-'));
    const petJson = Buffer.from(
      JSON.stringify({
        id: 'yijian',
        displayName: '奕剑',
        spritesheetPath: 'spritesheet.webp',
      }),
      'utf8',
    );
    const sheet = tinyPng();
    const zipBody = buildZipBody();

    const fetchMock = vi.fn(async (url: string) => {
      // Live API: share-data with downloadUrl nested under pet.
      if (url.includes('/share-data') || (url.includes('/api/pets/yijian') && !url.includes('download'))) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            pet: {
              id: 'yijian',
              displayName: '奕剑',
              downloadUrl: '/api/pets/yijian/download?v=1',
            },
          }),
        };
      }
      if (url.includes('download')) {
        return {
          ok: true,
          status: 200,
          body: (async function* () {
            yield new Uint8Array(zipBody);
          })(),
        };
      }
      return { ok: false, status: 404, body: null };
    });

    const unzipMock = vi.fn(async (_zip: string, dest: string) => {
      await writeFile(join(dest, 'pet.json'), petJson);
      await writeFile(join(dest, 'spritesheet.webp'), sheet);
    });

    try {
      const result = await installPetFromCodexPetsNet(
        {
          piwinRoot: root,
          petsDir: join(root, 'pets'),
          codexPetsDir: join(root, 'codex'),
        },
        'yijian',
        { fetch: fetchMock as never, unzip: unzipMock },
      );
      expect(result.petId).toBe('yijian');
      expect(result.source).toBe('registry');
      const installed = JSON.parse(
        await readFile(join(result.path, 'pet.json'), 'utf8'),
      ) as { id: string };
      expect(installed.id).toBe('yijian');
      await readFile(join(result.path, 'spritesheet.webp'));
      expect(unzipMock).toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects non-https download url', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-cpn-bad-'));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        pet: { id: 'x' },
        downloadUrl: 'http://evil.com/api/pets/x/download',
      }),
    }));
    try {
      await expect(
        installPetFromCodexPetsNet(
          {
            piwinRoot: root,
            petsDir: join(root, 'pets'),
            codexPetsDir: join(root, 'codex'),
          },
          'x',
          { fetch: fetchMock as never, unzip: vi.fn() as never },
        ),
      ).rejects.toThrow(/https|host/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid pet.json post-extract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-cpn-invalid-'));
    const zipBody = buildZipBody();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/pets/bad') && !url.includes('download')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            pet: { id: 'bad' },
            downloadUrl: '/api/pets/bad/download?v=1',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        body: (async function* () {
          yield new Uint8Array(zipBody);
        })(),
      };
    });
    const unzipMock = vi.fn(async (_zip: string, dest: string) => {
      // Incomplete manifest (no displayName) → validation fails.
      await writeFile(join(dest, 'pet.json'), JSON.stringify({ id: 'bad' }));
    });
    try {
      await expect(
        installPetFromCodexPetsNet(
          {
            piwinRoot: root,
            petsDir: join(root, 'pets'),
            codexPetsDir: join(root, 'codex'),
          },
          'bad',
          { fetch: fetchMock as never, unzip: unzipMock },
        ),
      ).rejects.toThrow(/displayName|spritesheet|validation|path/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
