import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHostEntry } from './create-host-entry.js';

let rootDir: string;
beforeEach(async () => {
  rootDir = await realpath(await mkdtemp(join(os.tmpdir(), 'piwin-create-entry-')));
});
afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('createHostEntry', () => {
  it('creates a folder and an empty file in the selected existing parent', async () => {
    const folder = await createHostEntry({
      parentPath: rootDir,
      name: '项目资料',
      kind: 'directory',
    });
    expect(folder).toEqual({
      name: '项目资料',
      path: join(rootDir, '项目资料'),
      kind: 'directory',
    });
    expect((await stat(folder.path)).isDirectory()).toBe(true);
    const file = await createHostEntry({
      parentPath: folder.path,
      name: '.gitignore',
      kind: 'file',
    });
    expect(await readFile(file.path, 'utf8')).toBe('');
  });
  it.each(['file', 'directory'] as const)(
    'preserves an existing %s on either creation kind',
    async (existingKind) => {
      const entryPath = join(rootDir, 'existing');
      if (existingKind === 'file') await writeFile(entryPath, 'keep this');
      else await mkdir(entryPath);
      for (const kind of ['file', 'directory'] as const) {
        await expect(
          createHostEntry({ parentPath: rootDir, name: 'existing', kind }),
        ).rejects.toMatchObject({
          name: 'HostEntryCreateError',
          code: 'host-entry-already-exists',
        });
      }
      if (existingKind === 'file') expect(await readFile(entryPath, 'utf8')).toBe('keep this');
    },
  );
  it('rejects existing and dangling symlinks without modifying their targets', async () => {
    const target = join(rootDir, 'target.txt');
    await writeFile(target, 'keep target');
    await symlink(target, join(rootDir, 'link'));
    await symlink(join(rootDir, 'missing-target'), join(rootDir, 'dangling'));
    for (const name of ['link', 'dangling']) {
      for (const kind of ['file', 'directory'] as const) {
        await expect(createHostEntry({ parentPath: rootDir, name, kind })).rejects.toMatchObject({
          code: 'host-entry-already-exists',
        });
      }
    }
    expect(await readFile(target, 'utf8')).toBe('keep target');
    expect(await readdir(rootDir)).not.toContain('missing-target');
  });
  it('resolves a selected symlink parent and returns the canonical Host path', async () => {
    const parent = join(rootDir, 'real');
    await mkdir(parent);
    await symlink(parent, join(rootDir, 'alias'));
    const entry = await createHostEntry({
      parentPath: join(rootDir, 'alias'),
      name: 'file.txt',
      kind: 'file',
    });
    expect(entry.path).toBe(join(parent, 'file.txt'));
  });
  it.each(['../escape', '/absolute', 'a/b', 'a\\b', '.', '..', 'a\0b'])(
    'rejects %j without writing',
    async (name) => {
      await expect(
        createHostEntry({ parentPath: rootDir, name, kind: 'file' }),
      ).rejects.toMatchObject({ code: 'host-entry-invalid-name' });
      expect(await readdir(rootDir)).toEqual([]);
    },
  );
  it('requires an existing absolute parent directory', async () => {
    for (const parentPath of ['relative', join(rootDir, 'missing')]) {
      await expect(
        createHostEntry({ parentPath, name: 'entry', kind: 'directory' }),
      ).rejects.toMatchObject({ code: 'host-entry-not-directory' });
    }
    const filePath = join(rootDir, 'file.txt');
    await writeFile(filePath, 'existing');
    await expect(
      createHostEntry({ parentPath: filePath, name: 'entry', kind: 'file' }),
    ).rejects.toMatchObject({ code: 'host-entry-not-directory' });
  });
  it('creates exclusively even when requests race', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        createHostEntry({ parentPath: rootDir, name: 'race.txt', kind: 'file' }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(3);
  });
});
