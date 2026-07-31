import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
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

/**
 * Build a fake zip body: ZIP magic bytes + padding so downloadAndVerifyPackage
 * accepts it. The mock unzip ignores the bytes and writes the real pet files.
 */
function fakeZipBody(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('not-a-real-zip-but-magic-checks-out'),
  ]);
}

function makeBodyResponse(body: Buffer) {
  return {
    ok: true,
    status: 200,
    body: (async function* () {
      yield body;
    })(),
  };
}

describe('registryProvider.install', () => {
  it('downloads, extracts (flat), validates, and renames to the target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-install-'));
    const petsDir = join(root, 'pets');
    const body = fakeZipBody();
    const sha256 = createHash('sha256').update(body).digest('hex');
    const entry = {
      id: 'install-flat',
      displayName: 'Install Flat',
      url: 'https://reg.test/install-flat.zip',
      sha256,
      sizeBytes: body.length,
    };

    // Mock unzip writes the pet contents directly into staging (flat layout,
    // no top-level folder) — this is the case that used to leak the zip.
    const unzipMock = vi.fn(async (_zipPath: string, destDir: string) => {
      await writeFile(
        join(destDir, 'pet.json'),
        JSON.stringify({
          id: 'install-flat',
          displayName: 'Install Flat',
          spritesheetPath: 'sheet.png',
        }),
      );
      await writeFile(join(destDir, 'sheet.png'), Buffer.from('png-bytes'));
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('catalog.json')) {
        return { ok: true, status: 200, json: async () => [entry] };
      }
      return makeBodyResponse(body);
    });

    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      fetch: fetchMock as never,
      unzip: unzipMock as never,
    };

    const result = await registryProvider.install!(ctx as never, JSON.stringify(entry));
    expect(result.petId).toBe('install-flat');
    expect(result.source).toBe('registry');
    expect(result.path).toBe(join(petsDir, 'install-flat'));

    // pet.json + spritesheet are in place.
    const manifest = JSON.parse(await readFile(join(result.path, 'pet.json'), 'utf8')) as {
      id: string;
      spritesheetPath: string;
    };
    expect(manifest.id).toBe('install-flat');
    await expect(stat(join(result.path, 'sheet.png'))).resolves.toBeDefined();

    // The downloaded zip must NOT leak into the installed dir.
    const installedFiles = await readdir(result.path);
    expect(installedFiles.some((f) => f.endsWith('.zip'))).toBe(false);

    // Staging is cleaned up.
    await expect(stat(join(root, 'pets', '.staging', 'install-flat'))).rejects.toBeDefined();

    // unzip was invoked with the downloaded zip path and staging dir.
    expect(unzipMock).toHaveBeenCalledTimes(1);
    const [zipArg, destArg] = unzipMock.mock.calls[0]!;
    expect(String(zipArg).endsWith('install-flat.pet.zip')).toBe(true);
    expect(destArg).toBe(join(root, 'pets', '.staging', 'install-flat'));
  });

  it('handles a nested archive with a single top-level folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-install-'));
    const petsDir = join(root, 'pets');
    const body = fakeZipBody();
    const sha256 = createHash('sha256').update(body).digest('hex');
    const entry = {
      id: 'install-nested',
      displayName: 'Install Nested',
      url: 'https://reg.test/install-nested.zip',
      sha256,
      sizeBytes: body.length,
    };

    const unzipMock = vi.fn(async (_zipPath: string, destDir: string) => {
      const inner = join(destDir, 'install-nested');
      await mkdir(inner, { recursive: true });
      await writeFile(
        join(inner, 'pet.json'),
        JSON.stringify({
          id: 'install-nested',
          displayName: 'Install Nested',
          spritesheetPath: 'sheet.png',
        }),
      );
      await writeFile(join(inner, 'sheet.png'), Buffer.from('png-bytes'));
    });

    const fetchMock = vi.fn(async (url: string) => makeBodyResponse(body));

    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      fetch: fetchMock as never,
      unzip: unzipMock as never,
    };

    const result = await registryProvider.install!(ctx as never, JSON.stringify(entry));
    expect(result.petId).toBe('install-nested');
    expect(result.path).toBe(join(petsDir, 'install-nested'));
    const installedFiles = await readdir(result.path);
    expect(installedFiles.sort()).toEqual(['pet.json', 'sheet.png']);
  });

  it('cleans up staging and rejects when extraction fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-install-'));
    const petsDir = join(root, 'pets');
    const body = fakeZipBody();
    const sha256 = createHash('sha256').update(body).digest('hex');
    const entry = {
      id: 'install-fail',
      displayName: 'Install Fail',
      url: 'https://reg.test/install-fail.zip',
      sha256,
      sizeBytes: body.length,
    };

    const unzipMock = vi.fn(async () => {
      throw new Error('unzip exploded');
    });
    const fetchMock = vi.fn(async () => makeBodyResponse(body));

    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      fetch: fetchMock as never,
      unzip: unzipMock as never,
    };

    await expect(registryProvider.install!(ctx as never, JSON.stringify(entry))).rejects.toThrow(
      'unzip exploded',
    );

    // Staging dir is gone.
    await expect(stat(join(root, 'pets', '.staging', 'install-fail'))).rejects.toBeDefined();
    // Nothing was installed.
    await expect(stat(join(petsDir, 'install-fail'))).rejects.toBeDefined();
  });

  it('rejects an invalid manifest and cleans up staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-install-'));
    const petsDir = join(root, 'pets');
    const body = fakeZipBody();
    const sha256 = createHash('sha256').update(body).digest('hex');
    const entry = {
      id: 'install-bad',
      displayName: 'Install Bad',
      url: 'https://reg.test/install-bad.zip',
      sha256,
      sizeBytes: body.length,
    };

    const unzipMock = vi.fn(async (_zipPath: string, destDir: string) => {
      // Missing spritesheetPath → validation failure.
      await writeFile(
        join(destDir, 'pet.json'),
        JSON.stringify({ id: 'install-bad', displayName: 'Bad' }),
      );
    });
    const fetchMock = vi.fn(async () => makeBodyResponse(body));

    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      fetch: fetchMock as never,
      unzip: unzipMock as never,
    };

    await expect(registryProvider.install!(ctx as never, JSON.stringify(entry))).rejects.toThrow(
      'spritesheetPath',
    );
    await expect(stat(join(petsDir, 'install-bad'))).rejects.toBeDefined();
    // Clean up root after test.
    await rm(root, { recursive: true, force: true });
  });

  it('rejects a catalog entry id that escapes the pets dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-install-'));
    const petsDir = join(root, 'pets');
    const body = fakeZipBody();
    const sha256 = createHash('sha256').update(body).digest('hex');
    const entry = {
      id: '../evil',
      displayName: 'Evil',
      url: 'https://reg.test/evil.zip',
      sha256,
      sizeBytes: body.length,
    };

    const unzipMock = vi.fn(async () => {});
    const fetchMock = vi.fn(async () => makeBodyResponse(body));

    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      fetch: fetchMock as never,
      unzip: unzipMock as never,
    };

    await expect(registryProvider.install!(ctx as never, JSON.stringify(entry))).rejects.toThrow(
      'unsafe pet id',
    );

    // Nothing was created outside the pets dir.
    await expect(stat(join(petsDir, '..', 'evil'))).rejects.toBeDefined();
    await expect(stat(join(root, 'pets', '.staging', '..', 'evil'))).rejects.toBeDefined();
    await rm(root, { recursive: true, force: true });
  });

  it('rejects a manifest id that escapes the pets dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-install-'));
    const petsDir = join(root, 'pets');
    const body = fakeZipBody();
    const sha256 = createHash('sha256').update(body).digest('hex');
    const entry = {
      id: 'manifest-traversal',
      displayName: 'Manifest Traversal',
      url: 'https://reg.test/mt.zip',
      sha256,
      sizeBytes: body.length,
    };

    const unzipMock = vi.fn(async (_zipPath: string, destDir: string) => {
      await writeFile(
        join(destDir, 'pet.json'),
        JSON.stringify({
          id: '../evil',
          displayName: 'Evil',
          spritesheetPath: 'sheet.png',
        }),
      );
      await writeFile(join(destDir, 'sheet.png'), Buffer.from('png-bytes'));
    });
    const fetchMock = vi.fn(async () => makeBodyResponse(body));

    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      fetch: fetchMock as never,
      unzip: unzipMock as never,
    };

    await expect(registryProvider.install!(ctx as never, JSON.stringify(entry))).rejects.toThrow(
      'id',
    );

    // The malicious manifest id never became a real path, and the staging
    // dir was cleaned up.
    await expect(stat(join(petsDir, '..', 'evil'))).rejects.toBeDefined();
    await expect(stat(join(petsDir, 'manifest-traversal'))).rejects.toBeDefined();
    await rm(root, { recursive: true, force: true });
  });

  it('replaces an already-installed pet cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-install-'));
    const petsDir = join(root, 'pets');
    const body = fakeZipBody();
    const sha256 = createHash('sha256').update(body).digest('hex');
    const entry = {
      id: 'reinstall',
      displayName: 'Reinstall',
      url: 'https://reg.test/reinstall.zip',
      sha256,
      sizeBytes: body.length,
    };

    const unzipMock = vi.fn(async (_zipPath: string, destDir: string) => {
      await writeFile(
        join(destDir, 'pet.json'),
        JSON.stringify({
          id: 'reinstall',
          displayName: 'v1',
          spritesheetPath: 'sheet.png',
        }),
      );
      await writeFile(join(destDir, 'sheet.png'), Buffer.from('v1-bytes'));
      await writeFile(join(destDir, 'stale.txt'), 'legacy');
    });
    const fetchMock = vi.fn(async () => makeBodyResponse(body));

    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      fetch: fetchMock as never,
      unzip: unzipMock as never,
    };

    const first = await registryProvider.install!(ctx as never, JSON.stringify(entry));
    expect(await readFile(join(first.path, 'sheet.png'), 'utf8')).toBe('v1-bytes');

    // Reinstall with different content; must fully replace the old install.
    unzipMock.mockImplementation(async (_zipPath: string, destDir: string) => {
      await writeFile(
        join(destDir, 'pet.json'),
        JSON.stringify({
          id: 'reinstall',
          displayName: 'v2',
          spritesheetPath: 'sheet.png',
        }),
      );
      await writeFile(join(destDir, 'sheet.png'), Buffer.from('v2-bytes'));
    });

    const second = await registryProvider.install!(ctx as never, JSON.stringify(entry));
    expect(await readFile(join(second.path, 'sheet.png'), 'utf8')).toBe('v2-bytes');
    // Old content is gone.
    await expect(stat(join(second.path, 'stale.txt'))).rejects.toBeDefined();
    // No staging or backup/trash dirs left behind.
    expect((await readdir(petsDir)).sort()).toEqual(['reinstall']);
  });
});
