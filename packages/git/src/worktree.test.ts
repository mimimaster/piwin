import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runGitCommand } from './git-command-runner.js';
import { isWorktreeBaseClean } from './worktree-integration.js';
import {
  createWorktree,
  isWorktreeUsable,
  removeWorktree,
  resetWorktreeToBase,
} from './worktree.js';

const temporaryRepositories: string[] = [];

async function runGit(repositoryPath: string, args: string[]): Promise<string> {
  const result = await runGitCommand({ cwd: repositoryPath, args });
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'piwin-worktree-'));
  temporaryRepositories.push(repositoryPath);
  await runGit(repositoryPath, ['init', '-b', 'main']);
  await runGit(repositoryPath, ['config', 'user.email', 'piwin-test@example.com']);
  await runGit(repositoryPath, ['config', 'user.name', 'piwin test']);
  await writeFile(join(repositoryPath, 'README.md'), 'base\n');
  await runGit(repositoryPath, ['add', '--all']);
  await runGit(repositoryPath, ['commit', '-m', 'base']);
  return repositoryPath;
}

describe('subagent worktrees', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRepositories
        .splice(0)
        .map((repositoryPath) => rm(repositoryPath, { recursive: true, force: true })),
    );
  });

  it('does not treat Piwin internal worktrees as dirty-base user changes', async () => {
    const projectPath = await createRepository();
    await createWorktree({ projectPath, name: 'clean-check' });

    expect(await isWorktreeBaseClean(projectPath)).toBe(true);
  });

  it('uses product storage and deletes the generated branch during forced cleanup', async () => {
    const projectPath = await createRepository();
    const storageRoot = await mkdtemp(join(tmpdir(), 'piwin-worktree-storage-'));
    temporaryRepositories.push(storageRoot);
    const worktree = await createWorktree({
      projectPath,
      name: 'cleanup',
      storageRoot,
    });
    await writeFile(join(worktree.worktreePath, 'new.txt'), 'new\n');

    await removeWorktree({
      projectPath,
      worktreePath: worktree.worktreePath,
      worktreeBranch: worktree.branch,
      force: true,
    });

    await expect(access(worktree.worktreePath)).rejects.toThrow();
    const branchCheck = await runGitCommand({
      cwd: projectPath,
      args: ['rev-parse', '--verify', worktree.branch],
      allowFailure: true,
    });
    expect(branchCheck.exitCode).not.toBe(0);
    expect(worktree.worktreePath.startsWith(storageRoot)).toBe(true);
    expect(await isWorktreeBaseClean(projectPath)).toBe(true);
  });
});

describe('writer slot safety', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('never treats a plain directory inside another repository as a checkout to reset', async () => {
    // A slot whose `.git` file vanished, sitting inside some enclosing repo.
    const enclosing = await createRepository();
    const orphanSlot = join(enclosing, 'worktrees', 'slot-0');
    await mkdir(orphanSlot, { recursive: true });
    await writeFile(join(enclosing, 'README.md'), 'uncommitted user work\n');
    const base = await runGit(enclosing, ['rev-parse', 'HEAD']);

    expect(await isWorktreeUsable(enclosing)).toBe(true);
    expect(await isWorktreeUsable(orphanSlot)).toBe(false);
    await expect(resetWorktreeToBase({ worktreePath: orphanSlot, baseCommit: base })).rejects.toThrow(
      /not its own git checkout/,
    );
    // The enclosing repository's work is untouched.
    expect(await readFile(join(enclosing, 'README.md'), 'utf8')).toBe('uncommitted user work\n');
  });
});
