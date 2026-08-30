import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTurnChangeObjectStore, DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES } from './object-store.js';
import { deleteTurnChangeFile, writeTurnChangeFile } from './file-writer.js';

const temporaryDirectories: string[] = [];
const text = new TextEncoder();

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createHarness(): Promise<{
  workspaceRoot: string;
  store: ReturnType<typeof createTurnChangeObjectStore>;
}> {
  const workspaceRoot = await createTempDir('piwin-turn-change-writer-ws-');
  const storeRoot = await createTempDir('piwin-turn-change-writer-store-');
  return { workspaceRoot, store: createTurnChangeObjectStore({ rootDir: storeRoot }) };
}

async function leftoverTemps(directory: string): Promise<string[]> {
  const names = await readdir(directory);
  return names.filter((name) => name.startsWith('.piwin-tc-'));
}

function expectSha(sha: string | null): string {
  expect(sha).toMatch(/^[0-9a-f]{64}$/);
  if (sha === null) {
    throw new Error('expected sha256');
  }
  return sha;
}

describe('writeTurnChangeFile / deleteTurnChangeFile', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('creates a missing file and stores after bytes', async () => {
    const { workspaceRoot, store } = await createHarness();
    await mkdir(join(workspaceRoot, 'src'));
    const bytes = text.encode('export {}\n');

    const receipt = await writeTurnChangeFile({
      workspaceRoot,
      relativePath: 'src/a.ts',
      bytes,
      store,
    });

    expect(receipt).toEqual({
      relativePath: 'src/a.ts',
      beforeSha: null,
      afterSha: expectSha(receipt.afterSha),
      beforeExists: false,
      afterExists: true,
    });
    expect(await store.get(expectSha(receipt.afterSha))).toEqual(bytes);
    expect(await readFile(join(workspaceRoot, 'src/a.ts'))).toEqual(Buffer.from(bytes));
    expect(await leftoverTemps(join(workspaceRoot, 'src'))).toEqual([]);
    if (process.platform !== 'win32') {
      expect((await stat(join(workspaceRoot, 'src/a.ts'))).mode & 0o777).toBe(0o644);
    }
  });

  it('overwrites a file and keeps beforeSha distinct from afterSha', async () => {
    const { workspaceRoot, store } = await createHarness();
    const before = text.encode('before\n');
    const after = text.encode('after\n');
    await writeFile(join(workspaceRoot, 'note.txt'), before);
    await chmod(join(workspaceRoot, 'note.txt'), 0o755);

    const receipt = await writeTurnChangeFile({
      workspaceRoot,
      relativePath: 'note.txt',
      bytes: after,
      store,
    });

    expect(receipt.beforeExists).toBe(true);
    expect(receipt.afterExists).toBe(true);
    expect(receipt.beforeSha).not.toBe(receipt.afterSha);
    expect(await store.get(expectSha(receipt.beforeSha))).toEqual(before);
    expect(await store.get(expectSha(receipt.afterSha))).toEqual(after);
    expect(await readFile(join(workspaceRoot, 'note.txt'))).toEqual(Buffer.from(after));
    expect(await leftoverTemps(workspaceRoot)).toEqual([]);
    if (process.platform !== 'win32') {
      expect((await stat(join(workspaceRoot, 'note.txt'))).mode & 0o777).toBe(0o755);
    }
  });

  it('creates missing intermediate directories without deleting siblings', async () => {
    const { workspaceRoot, store } = await createHarness();
    await mkdir(join(workspaceRoot, 'src'));
    await writeFile(join(workspaceRoot, 'src/keep.txt'), 'keep\n');

    const receipt = await writeTurnChangeFile({
      workspaceRoot,
      relativePath: 'src/nested/new.ts',
      bytes: text.encode('created\n'),
      store,
    });

    expect(receipt.beforeExists).toBe(false);
    expect(receipt.afterExists).toBe(true);
    expect(await readFile(join(workspaceRoot, 'src/keep.txt'), 'utf8')).toBe('keep\n');
    expect(await readFile(join(workspaceRoot, 'src/nested/new.ts'), 'utf8')).toBe('created\n');
  });

  it('deletes one file and can read the before bytes back from the store', async () => {
    const { workspaceRoot, store } = await createHarness();
    const before = text.encode('remove-me\n');
    await writeFile(join(workspaceRoot, 'gone.txt'), before);

    const receipt = await deleteTurnChangeFile({
      workspaceRoot,
      relativePath: 'gone.txt',
      store,
    });

    expect(receipt).toEqual({
      relativePath: 'gone.txt',
      beforeSha: expectSha(receipt.beforeSha),
      afterSha: null,
      beforeExists: true,
      afterExists: false,
    });
    expect(await store.get(expectSha(receipt.beforeSha))).toEqual(before);
    await expect(stat(join(workspaceRoot, 'gone.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await leftoverTemps(workspaceRoot)).toEqual([]);
  });

  it('throws not found when deleting a missing path', async () => {
    const { workspaceRoot, store } = await createHarness();

    await expect(
      deleteTurnChangeFile({
        workspaceRoot,
        relativePath: 'missing.txt',
        store,
      }),
    ).rejects.toThrow(/not found/);
    expect(await readdir(workspaceRoot)).toEqual([]);
  });

  it('rejects a symlink target and leaves the link in place', async () => {
    const { workspaceRoot, store } = await createHarness();
    await writeFile(join(workspaceRoot, 'real.txt'), 'inside\n');
    await symlink(join(workspaceRoot, 'real.txt'), join(workspaceRoot, 'alias.txt'));

    await expect(
      writeTurnChangeFile({
        workspaceRoot,
        relativePath: 'alias.txt',
        bytes: text.encode('overwrite\n'),
        store,
      }),
    ).rejects.toThrow(/symlink/);
    await expect(
      deleteTurnChangeFile({
        workspaceRoot,
        relativePath: 'alias.txt',
        store,
      }),
    ).rejects.toThrow(/symlink/);

    expect((await lstat(join(workspaceRoot, 'alias.txt'))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(workspaceRoot, 'real.txt'), 'utf8')).toBe('inside\n');
    expect(await leftoverTemps(workspaceRoot)).toEqual([]);
  });

  it('rejects a path that escapes the workspace with zero writes', async () => {
    const { workspaceRoot, store } = await createHarness();
    const outside = join(dirname(workspaceRoot), 'piwin-tc-should-not-escape.txt');

    await expect(
      writeTurnChangeFile({
        workspaceRoot,
        relativePath: '../piwin-tc-should-not-escape.txt',
        bytes: text.encode('nope\n'),
        store,
      }),
    ).rejects.toThrow(/escapes/);
    await expect(
      deleteTurnChangeFile({
        workspaceRoot,
        relativePath: '../piwin-tc-should-not-escape.txt',
        store,
      }),
    ).rejects.toThrow(/escapes/);

    await expect(stat(outside)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(workspaceRoot)).toEqual([]);
  });

  it('rejects a directory with zero writes', async () => {
    const { workspaceRoot, store } = await createHarness();
    await mkdir(join(workspaceRoot, 'src'));
    await writeFile(join(workspaceRoot, 'src/a.ts'), 'keep\n');

    await expect(
      writeTurnChangeFile({
        workspaceRoot,
        relativePath: 'src',
        bytes: text.encode('nope\n'),
        store,
      }),
    ).rejects.toThrow(/directory/);
    await expect(
      deleteTurnChangeFile({
        workspaceRoot,
        relativePath: 'src',
        store,
      }),
    ).rejects.toThrow(/directory/);

    expect((await lstat(join(workspaceRoot, 'src'))).isDirectory()).toBe(true);
    expect(await readFile(join(workspaceRoot, 'src/a.ts'), 'utf8')).toBe('keep\n');
  });

  it('rejects oversized writes and leaves the disk unchanged', async () => {
    const { workspaceRoot, store } = await createHarness();
    await mkdir(join(workspaceRoot, 'src'));
    await writeFile(join(workspaceRoot, 'src/a.ts'), 'small\n');
    const oversized = new Uint8Array(DEFAULT_TURN_CHANGE_MAX_OBJECT_BYTES + 1);

    await expect(
      writeTurnChangeFile({
        workspaceRoot,
        relativePath: 'src/a.ts',
        bytes: oversized,
        store,
      }),
    ).rejects.toThrow(/maxObjectBytes/);
    await expect(
      writeTurnChangeFile({
        workspaceRoot,
        relativePath: 'src/nested/new.ts',
        bytes: oversized,
        store,
      }),
    ).rejects.toThrow(/maxObjectBytes/);

    expect(await readFile(join(workspaceRoot, 'src/a.ts'), 'utf8')).toBe('small\n');
    await expect(stat(join(workspaceRoot, 'src/nested'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await leftoverTemps(join(workspaceRoot, 'src'))).toEqual([]);
  });
});
