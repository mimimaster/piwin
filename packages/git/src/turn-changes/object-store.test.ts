import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createTurnChangeObjectStore,
  DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES,
} from './object-store.js';

const temporaryDirectories: string[] = [];

async function createRootDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-turn-change-objects-'));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function objectPath(rootDir: string, sha256: string): string {
  return join(rootDir, 'objects', sha256.slice(0, 2), sha256.slice(2));
}

describe('createTurnChangeObjectStore', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('puts and gets the same bytes at a lowercase sha256 path', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const bytes = new TextEncoder().encode('turn-change-object');

    const put = await store.put(bytes);
    expect(put.sha256).toBe(sha256Hex(bytes));
    expect(put.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(put.byteLength).toBe(bytes.byteLength);

    const got = await store.get(put.sha256);
    expect(got).toEqual(bytes);
    expect(await readFile(objectPath(rootDir, put.sha256))).toEqual(Buffer.from(bytes));

    const listed = await store.stat(put.sha256);
    expect(listed).toEqual(put);
  });

  it('rejects oversized puts with zero writes', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir, maxObjectBytes: 4 });

    await expect(store.put(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(/maxObjectBytes/);
    expect(await readdir(rootDir)).toEqual([]);
    expect(DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES).toBe(20 * 1024 * 1024);
  });

  it('reuses an existing object with the same hash without rewriting', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const bytes = new TextEncoder().encode('reuse-me');

    const first = await store.put(bytes);
    const path = objectPath(rootDir, first.sha256);
    const before = await stat(path);

    const second = await store.put(bytes);
    expect(second).toEqual(first);
    const after = await stat(path);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('does not overwrite a corrupt existing object', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const bytes = new TextEncoder().encode('original-bytes');
    const put = await store.put(bytes);
    const path = objectPath(rootDir, put.sha256);
    await writeFile(path, 'tampered');

    await expect(store.put(bytes)).rejects.toThrow(/corrupt-object/);
    expect(await readFile(path, 'utf8')).toBe('tampered');
    await expect(store.get(put.sha256)).rejects.toThrow(/corrupt-object/);
  });

  it('rejects sha256 arguments that are not lowercase 64-char hex', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const invalid = [
      'abc',
      'A'.repeat(64),
      'g'.repeat(64),
      `${'a'.repeat(63)}`,
      `${'a'.repeat(65)}`,
    ];

    for (const sha256 of invalid) {
      await expect(store.get(sha256)).rejects.toThrow(/invalid sha256/);
      await expect(store.stat(sha256)).rejects.toThrow(/invalid sha256/);
    }
  });

  it('returns undefined from stat when the object is missing', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const missing = 'a'.repeat(64);

    expect(await store.stat(missing)).toBeUndefined();
    await expect(store.get(missing)).rejects.toThrow(/not found/);
  });

  it('writes object files as 0o600 on posix', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const put = await store.put(new TextEncoder().encode('secret'));
    const mode = (await stat(objectPath(rootDir, put.sha256))).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
