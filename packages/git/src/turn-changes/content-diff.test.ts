import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitCommandError } from '../git-command-runner.js';
import * as gitCommandRunner from '../git-command-runner.js';
import { createTurnChangeObjectStore } from './object-store.js';
import { diffTurnChangeObjects } from './content-diff.js';

const temporaryDirectories: string[] = [];
const textEncoder = new TextEncoder();

async function createRootDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-turn-change-diff-'));
  temporaryDirectories.push(directory);
  return directory;
}

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

describe('diffTurnChangeObjects', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('returns 0/0 for identical objects', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const put = await store.put(bytes('same\n'));

    const result = await diffTurnChangeObjects({
      store,
      beforeSha: put.sha256,
      afterSha: put.sha256,
      pathLabel: 'same.txt',
    });

    expect(result).toEqual({ additions: 0, deletions: 0, binary: false });
  });

  it('counts a text replacement and labels the patch with pathLabel', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const before = await store.put(bytes('alpha\n'));
    const after = await store.put(bytes('beta\n'));

    const result = await diffTurnChangeObjects({
      store,
      beforeSha: before.sha256,
      afterSha: after.sha256,
      pathLabel: 'src/a.ts',
    });

    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.binary).toBe(false);
    expect(result.patch).toContain('src/a.ts');
    expect(result.patch).toContain('-alpha');
    expect(result.patch).toContain('+beta');
  });

  it('accepts a Chinese pathLabel without using it as git cwd', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const before = await store.put(bytes('旧\n'));
    const after = await store.put(bytes('新\n'));

    const result = await diffTurnChangeObjects({
      store,
      beforeSha: before.sha256,
      afterSha: after.sha256,
      pathLabel: '文档/测试.txt',
    });

    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.binary).toBe(false);
    expect(result.patch).toContain('文档/测试.txt');
  });

  it('counts ++/-- content lines from numstat instead of patch-line heuristics', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const before = await store.put(bytes('keep\n'));
    const after = await store.put(bytes('++ plusplus\nchanged\n-- minusminus\n'));

    const result = await diffTurnChangeObjects({
      store,
      beforeSha: before.sha256,
      afterSha: after.sha256,
      pathLabel: 'markers.txt',
    });

    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(1);
    expect(result.binary).toBe(false);
  });

  it('counts a missing trailing newline as a real line change', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const before = await store.put(bytes('hello'));
    const after = await store.put(bytes('hello\nworld\n'));

    const result = await diffTurnChangeObjects({
      store,
      beforeSha: before.sha256,
      afterSha: after.sha256,
      pathLabel: 'nonewline.txt',
    });

    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(1);
    expect(result.binary).toBe(false);
  });

  it('keeps binary numstat dashes as null rather than zero', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const before = await store.put(bytes('hello\n'));
    const after = await store.put(new Uint8Array([0x00, 0x01, 0x02, 0xff]));

    const result = await diffTurnChangeObjects({
      store,
      beforeSha: before.sha256,
      afterSha: after.sha256,
      pathLabel: 'blob.bin',
    });

    expect(result).toEqual({ additions: null, deletions: null, binary: true });
  });

  it('diffs a missing before side against an empty temp file', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const after = await store.put(bytes('hello\n'));

    const result = await diffTurnChangeObjects({
      store,
      beforeSha: null,
      afterSha: after.sha256,
      pathLabel: 'created.txt',
    });

    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(0);
    expect(result.binary).toBe(false);
  });

  it('returns 0/0 binary false for a new empty file', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const after = await store.put(new Uint8Array());

    const result = await diffTurnChangeObjects({
      store,
      beforeSha: null,
      afterSha: after.sha256,
      pathLabel: 'empty.txt',
    });

    expect(result).toEqual({ additions: 0, deletions: 0, binary: false });
  });

  it('cleans temp files under the object store rootDir', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const before = await store.put(bytes('a\n'));
    const after = await store.put(bytes('b\n'));

    await diffTurnChangeObjects({
      store,
      beforeSha: before.sha256,
      afterSha: after.sha256,
      pathLabel: 'tmp.txt',
    });

    const leftover = await readdir(join(rootDir, 'temp')).catch(() => []);
    expect(leftover).toEqual([]);
  });

  it('runs git --no-index without /dev/null and with allowedExitCodes 0/1', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const after = await store.put(bytes('hello\n'));
    const spy = vi.spyOn(gitCommandRunner, 'runGitCommand');

    await diffTurnChangeObjects({
      store,
      beforeSha: null,
      afterSha: after.sha256,
      pathLabel: join(rootDir, 'not-cwd', 'created.txt'),
    });

    expect(spy).toHaveBeenCalled();
    for (const [options] of spy.mock.calls) {
      expect(options.allowedExitCodes).toEqual([0, 1]);
      expect(options.cwd.startsWith(rootDir)).toBe(true);
      expect(options.cwd).not.toBe(join(rootDir, 'not-cwd'));
      expect(options.args).toContain('--no-index');
      expect(options.args).toContain('--no-ext-diff');
      expect(options.args).toContain('--no-textconv');
      expect(options.args).toContain('--no-renames');
      expect(options.args.join('\0')).not.toContain('/dev/null');
    }
    expect(spy.mock.calls.some(([options]) => options.args.includes('--numstat'))).toBe(true);
  });

  it('throws spawn and timeout errors instead of treating them as a content diff', async () => {
    const rootDir = await createRootDir();
    const store = createTurnChangeObjectStore({ rootDir });
    const after = await store.put(bytes('hello\n'));
    vi.spyOn(gitCommandRunner, 'runGitCommand').mockRejectedValueOnce(
      new GitCommandError('spawn git ENOENT', {
        exitCode: 1,
        stderr: '',
        args: ['diff'],
        kind: 'spawn',
      }),
    );

    await expect(
      diffTurnChangeObjects({
        store,
        beforeSha: null,
        afterSha: after.sha256,
        pathLabel: 'created.txt',
      }),
    ).rejects.toMatchObject({ name: 'GitCommandError', kind: 'spawn' });

    vi.spyOn(gitCommandRunner, 'runGitCommand').mockRejectedValueOnce(
      new GitCommandError('Command failed: TIMEOUT', {
        exitCode: 1,
        stderr: '',
        args: ['diff'],
        kind: 'timeout',
      }),
    );

    await expect(
      diffTurnChangeObjects({
        store,
        beforeSha: null,
        afterSha: after.sha256,
        pathLabel: 'created.txt',
      }),
    ).rejects.toMatchObject({ name: 'GitCommandError', kind: 'timeout' });
  });
});
