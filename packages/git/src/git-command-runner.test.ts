import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyGitCommandError,
  GitCommandError,
  runGitCommand,
} from './git-command-runner.js';

const temporaryDirectories: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe('classifyGitCommandError', () => {
  it('classifies killed timeout as timeout', () => {
    expect(
      classifyGitCommandError({ killed: true, code: 'ERR_TIMEOUT', message: 'Command failed' }),
    ).toBe('timeout');
    expect(
      classifyGitCommandError({ killed: true, code: null, message: 'Command failed: TIMEOUT' }),
    ).toBe('timeout');
  });

  it('classifies other killed processes as killed', () => {
    expect(
      classifyGitCommandError({ killed: true, code: null, message: 'Command failed' }),
    ).toBe('killed');
    expect(
      classifyGitCommandError({ killed: true, code: 1, message: 'Command failed' }),
    ).toBe('killed');
  });

  it('classifies string codes as spawn', () => {
    expect(classifyGitCommandError({ code: 'ENOENT', message: 'spawn git ENOENT' })).toBe('spawn');
  });

  it('classifies numeric codes as exit', () => {
    expect(
      classifyGitCommandError({ code: 1, killed: false, message: 'Command failed' }),
    ).toBe('exit');
  });

  it('classifies remaining errors as spawn', () => {
    expect(classifyGitCommandError({ message: 'weird failure' })).toBe('spawn');
  });
});

describe('runGitCommand allowedExitCodes', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('returns exit 1 for git diff --no-index when 1 is allowed', async () => {
    const directory = await createTempDir('piwin-git-runner-');
    await writeFile(join(directory, 'left.txt'), 'alpha\n');
    await writeFile(join(directory, 'right.txt'), 'beta\n');

    const result = await runGitCommand({
      cwd: directory,
      args: ['diff', '--no-index', '--', 'left.txt', 'right.txt'],
      allowedExitCodes: [0, 1],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('beta');
  });

  it('throws kind exit when a numeric exit is not allowed', async () => {
    const directory = await createTempDir('piwin-git-runner-');
    await writeFile(join(directory, 'left.txt'), 'alpha\n');
    await writeFile(join(directory, 'right.txt'), 'beta\n');

    await expect(
      runGitCommand({
        cwd: directory,
        args: ['diff', '--no-index', '--', 'left.txt', 'right.txt'],
        allowedExitCodes: [0],
      }),
    ).rejects.toMatchObject({
      name: 'GitCommandError',
      kind: 'exit',
      exitCode: 1,
    });
  });

  it('does not report spawn as a successful exit 1 difference', async () => {
    await expect(
      runGitCommand({
        cwd: '/this/path/does/not/exist-piwin-git-runner',
        args: ['status'],
        allowedExitCodes: [0, 1],
      }),
    ).rejects.toMatchObject({
      name: 'GitCommandError',
      kind: 'spawn',
    });
  });

  it('does not report a hung git process timeout as exit 1', async () => {
    const directory = await createTempDir('piwin-git-runner-timeout-');
    await runGitCommand({ cwd: directory, args: ['init', '-b', 'main'] });

    const error = await runGitCommand({
      cwd: directory,
      args: ['cat-file', '--batch'],
      timeoutMs: 80,
      allowedExitCodes: [0, 1],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitCommandError);
    if (!(error instanceof GitCommandError)) {
      throw new Error('expected GitCommandError');
    }
    expect(['killed', 'timeout']).toContain(error.kind);
    expect(error.kind).not.toBe('exit');
  });

  it('keeps allowFailure mapping non-numeric codes to exitCode 1', async () => {
    const result = await runGitCommand({
      cwd: '/this/path/does/not/exist-piwin-git-runner',
      args: ['status'],
      allowFailure: true,
    });
    expect(result.exitCode).toBe(1);
  });
});
