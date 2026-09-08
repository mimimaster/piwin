import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertWritableTurnChangeFile,
  canonicalizeForContainment,
  resolveFileLockKey,
  resolveTurnChangePath,
} from './path-policy.js';

const temporaryDirectories: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe('resolveTurnChangePath / assertWritableTurnChangeFile', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('resolves a relative file and allows writable', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/a.ts'), 'export {}\n');

    const resolved = await resolveTurnChangePath({
      workspaceRoot: root,
      relativePath: 'src/a.ts',
    });
    expect(resolved).toEqual({
      relativePath: 'src/a.ts',
      absolutePath: resolve(root, 'src/a.ts'),
      kind: 'file',
    });
    await expect(
      assertWritableTurnChangeFile({ workspaceRoot: root, relativePath: 'src/a.ts' }),
    ).resolves.toEqual(resolved);
  });

  it('rejects parent-relative paths before touching the filesystem', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    await expect(
      resolveTurnChangePath({ workspaceRoot: root, relativePath: '../x' }),
    ).rejects.toThrow(/escapes/);
    await expect(
      assertWritableTurnChangeFile({ workspaceRoot: root, relativePath: '../x' }),
    ).rejects.toThrow(/escapes/);
  });

  it('classifies an in-root symlink as symlink and rejects writable', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    await writeFile(join(root, 'real.txt'), 'inside\n');
    await symlink(join(root, 'real.txt'), join(root, 'alias.txt'));

    const resolved = await resolveTurnChangePath({
      workspaceRoot: root,
      relativePath: 'alias.txt',
    });
    expect(resolved.kind).toBe('symlink');
    expect(resolved.relativePath).toBe('alias.txt');
    expect(resolved.absolutePath).toBe(resolve(root, 'alias.txt'));
    await expect(
      assertWritableTurnChangeFile({ workspaceRoot: root, relativePath: 'alias.txt' }),
    ).rejects.toThrow(/symlink/);
  });

  it('throws when a symlink realpath leaves the workspace', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    const outside = await createTempDir('piwin-turn-change-outside-');
    const outsideFile = join(outside, 'secret.txt');
    await writeFile(outsideFile, 'nope\n');
    await symlink(outsideFile, join(root, 'escape.txt'));

    await expect(
      resolveTurnChangePath({ workspaceRoot: root, relativePath: 'escape.txt' }),
    ).rejects.toThrow(/path escapes workspace/);
    await expect(
      assertWritableTurnChangeFile({ workspaceRoot: root, relativePath: 'escape.txt' }),
    ).rejects.toThrow(/path escapes workspace/);
  });

  it('rejects a relative symlink whose target resolves outside the root', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    const outside = await createTempDir('piwin-turn-change-outside-');
    const outsideFile = join(outside, 'secret.txt');
    await writeFile(outsideFile, 'nope\n');
    await symlink(join('..', basename(outside), 'secret.txt'), join(root, 'rel-escape.txt'));

    await expect(
      resolveTurnChangePath({ workspaceRoot: root, relativePath: 'rel-escape.txt' }),
    ).rejects.toThrow(/path escapes workspace/);
  });

  it('does not accept a neighbor whose path is a string prefix of the workspace', async () => {
    const parent = await createTempDir('piwin-turn-change-prefix-');
    const root = join(parent, 'ws');
    const neighbor = join(parent, 'ws-evil');
    await mkdir(root);
    await mkdir(neighbor);
    const secret = join(neighbor, 'secret.txt');
    await writeFile(secret, 'stolen\n');
    await symlink(secret, join(root, 'link.txt'));

    await expect(
      resolveTurnChangePath({ workspaceRoot: root, relativePath: 'link.txt' }),
    ).rejects.toThrow(/path escapes workspace/);
  });

  it('rejects writable for a directory', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    await mkdir(join(root, 'src'));

    const resolved = await resolveTurnChangePath({
      workspaceRoot: root,
      relativePath: 'src',
    });
    expect(resolved.kind).toBe('directory');
    await expect(
      assertWritableTurnChangeFile({ workspaceRoot: root, relativePath: 'src' }),
    ).rejects.toThrow(/directory/);
  });

  it('allows writable for a missing path', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    await mkdir(join(root, 'src'));

    const resolved = await resolveTurnChangePath({
      workspaceRoot: root,
      relativePath: 'src/new.ts',
    });
    expect(resolved).toEqual({
      relativePath: 'src/new.ts',
      absolutePath: resolve(root, 'src/new.ts'),
      kind: 'missing',
    });
    await expect(
      assertWritableTurnChangeFile({ workspaceRoot: root, relativePath: 'src/new.ts' }),
    ).resolves.toEqual(resolved);
  });

  it('rejects empty, absolute, and NUL relative paths', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    await expect(
      resolveTurnChangePath({ workspaceRoot: root, relativePath: '' }),
    ).rejects.toThrow(/empty/);
    await expect(
      resolveTurnChangePath({ workspaceRoot: root, relativePath: '/etc/passwd' }),
    ).rejects.toThrow(/absolute/);
    await expect(
      resolveTurnChangePath({ workspaceRoot: root, relativePath: 'a\0b.ts' }),
    ).rejects.toThrow(/null byte/);
  });

  it('rejects a non-absolute workspaceRoot', async () => {
    await expect(
      resolveTurnChangePath({ workspaceRoot: 'relative-root', relativePath: 'a.ts' }),
    ).rejects.toThrow(/absolute/);
  });

  it('walks an in-root directory symlink and classifies the nested file', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    await mkdir(join(root, 'real-dir'));
    await writeFile(join(root, 'real-dir/nested.ts'), 'ok\n');
    await symlink(join(root, 'real-dir'), join(root, 'linked-dir'));

    const resolved = await resolveTurnChangePath({
      workspaceRoot: root,
      relativePath: 'linked-dir/nested.ts',
    });
    expect(resolved.kind).toBe('file');
    await expect(
      assertWritableTurnChangeFile({
        workspaceRoot: root,
        relativePath: 'linked-dir/nested.ts',
      }),
    ).resolves.toEqual(resolved);
  });

  it('throws when an intermediate symlink leaves the workspace', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    const outside = await createTempDir('piwin-turn-change-outside-');
    await writeFile(join(outside, 'nested.txt'), 'nope\n');
    await symlink(outside, join(root, 'out-dir'));

    await expect(
      resolveTurnChangePath({ workspaceRoot: root, relativePath: 'out-dir/nested.txt' }),
    ).rejects.toThrow(/path escapes workspace/);
  });

  it('rejects a dangling relative symlink behind a directory symlink', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    await mkdir(join(root, 'real-dir'));
    await mkdir(join(root, 'deep'));
    await symlink('../../secret.txt', join(root, 'real-dir/link'));
    await symlink(join(root, 'real-dir'), join(root, 'deep/linked-dir'));

    await expect(
      resolveTurnChangePath({
        workspaceRoot: root,
        relativePath: 'deep/linked-dir/link',
      }),
    ).rejects.toThrow(/path escapes workspace/);
    await expect(
      assertWritableTurnChangeFile({
        workspaceRoot: root,
        relativePath: 'deep/linked-dir/link',
      }),
    ).rejects.toThrow(/path escapes workspace/);
  });

  it('classifies a fifo as unsupported and rejects writable', async () => {
    const root = await createTempDir('piwin-turn-change-path-');
    const fifoPath = join(root, 'pipe.fifo');
    const created = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
    expect(created.status).toBe(0);

    const resolved = await resolveTurnChangePath({
      workspaceRoot: root,
      relativePath: 'pipe.fifo',
    });
    expect(resolved.kind).toBe('unsupported');
    await expect(
      assertWritableTurnChangeFile({ workspaceRoot: root, relativePath: 'pipe.fifo' }),
    ).rejects.toThrow(/unsupported/);
  });
});

describe('resolveFileLockKey', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('uses realpath for an existing file', async () => {
    const root = await createTempDir('piwin-lock-key-');
    const filePath = join(root, 'a.ts');
    await writeFile(filePath, 'ok\n');
    const result = await resolveFileLockKey(filePath);
    expect(result).toEqual({ ok: true, key: await canonicalizeForContainment(filePath) });
  });

  it('shares one key for a missing file reached via a directory symlink', async () => {
    const root = await createTempDir('piwin-lock-key-alias-');
    const realDir = join(root, 'real');
    const aliasDir = join(root, 'alias');
    await mkdir(realDir);
    await symlink(realDir, aliasDir);

    const viaReal = await resolveFileLockKey(join(realDir, 'new.ts'));
    const viaAlias = await resolveFileLockKey(join(aliasDir, 'new.ts'));
    expect(viaReal).toEqual(viaAlias);
    expect(viaReal.ok).toBe(true);
    if (viaReal.ok) {
      expect(viaReal.key).toBe(join(await canonicalizeForContainment(realDir), 'new.ts'));
    }

    await writeFile(join(realDir, 'new.ts'), 'created\n');
    const afterCreate = await resolveFileLockKey(join(aliasDir, 'new.ts'));
    expect(afterCreate).toEqual(viaReal);
  });

  it('fails when an ancestor is not a directory', async () => {
    const root = await createTempDir('piwin-lock-key-enotdir-');
    const filePath = join(root, 'file.ts');
    await writeFile(filePath, 'not-a-dir\n');
    const result = await resolveFileLockKey(join(filePath, 'nested.ts'));
    expect(result).toEqual({ ok: false, reason: 'enotdir' });
  });

  it('does not treat an unrelated prefix directory as the same ancestor', async () => {
    const parent = await createTempDir('piwin-lock-key-prefix-');
    const repo = join(parent, 'repo');
    const other = join(parent, 'repo-other');
    await mkdir(repo);
    await mkdir(other);
    const left = await resolveFileLockKey(join(repo, 'a.ts'));
    const right = await resolveFileLockKey(join(other, 'a.ts'));
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (left.ok && right.ok) {
      expect(left.key).not.toBe(right.key);
    }
  });
});
