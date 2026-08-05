import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGitCommand } from './git-command-runner.js';
import { integrateWorktreeChanges } from './worktree-integration.js';

const temporaryRepositories: string[] = [];

async function runGit(repositoryPath: string, args: string[]): Promise<string> {
  const result = await runGitCommand({ cwd: repositoryPath, args });
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'piwin-worktree-integration-'));
  temporaryRepositories.push(repositoryPath);
  await runGit(repositoryPath, ['init', '-b', 'main']);
  await runGit(repositoryPath, ['config', 'user.email', 'piwin-test@example.com']);
  await runGit(repositoryPath, ['config', 'user.name', 'piwin test']);
  return repositoryPath;
}

async function commitAll(repositoryPath: string, message: string): Promise<string> {
  await runGit(repositoryPath, ['add', '--all']);
  await runGit(repositoryPath, ['commit', '-m', message]);
  return runGit(repositoryPath, ['rev-parse', 'HEAD']);
}

describe('integrateWorktreeChanges', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRepositories.splice(0).map((repositoryPath) =>
        rm(repositoryPath, { recursive: true, force: true }),
      ),
    );
  });

  it('uses the captured base and includes child working-tree changes', async () => {
    const projectPath = await createRepository();
    await writeFile(join(projectPath, 'first.txt'), 'base first\n');
    await writeFile(join(projectPath, 'second.txt'), 'base second\n');
    await writeFile(join(projectPath, 'third.txt'), 'base third\n');
    const baseCommit = await commitAll(projectPath, 'base');

    const worktreePath = join(projectPath, '.child-worktree');
    await runGit(projectPath, ['worktree', 'add', '-b', 'child', worktreePath, baseCommit]);

    await writeFile(join(worktreePath, 'first.txt'), 'child first\n');
    await commitAll(worktreePath, 'child first commit');
    await writeFile(join(worktreePath, 'second.txt'), 'child second\n');
    await commitAll(worktreePath, 'child second commit');
    await writeFile(join(worktreePath, 'third.txt'), 'child uncommitted\n');

    const result = await integrateWorktreeChanges({
      projectPath,
      worktreePath,
      worktreeBranch: 'child',
      baseCommit,
    });

    expect(result).toEqual({
      status: 'applied',
      integratedFiles: ['first.txt', 'second.txt', 'third.txt'],
      conflictedFiles: [],
      rejectedFiles: [],
    });
    await expect(readFile(join(projectPath, 'first.txt'), 'utf8')).resolves.toBe(
      'child first\n',
    );
    await expect(readFile(join(projectPath, 'second.txt'), 'utf8')).resolves.toBe(
      'child second\n',
    );
    await expect(readFile(join(projectPath, 'third.txt'), 'utf8')).resolves.toBe(
      'child uncommitted\n',
    );
  });

  it('rejects disallowed files before applying the patch', async () => {
    const projectPath = await createRepository();
    await writeFile(join(projectPath, 'allowed.txt'), 'base allowed\n');
    await writeFile(join(projectPath, 'forbidden.txt'), 'base forbidden\n');
    const baseCommit = await commitAll(projectPath, 'base');

    const worktreePath = join(projectPath, '.child-worktree');
    await runGit(projectPath, ['worktree', 'add', '-b', 'child', worktreePath, baseCommit]);
    await writeFile(join(worktreePath, 'allowed.txt'), 'child allowed\n');
    await writeFile(join(worktreePath, 'forbidden.txt'), 'child forbidden\n');

    const result = await integrateWorktreeChanges({
      projectPath,
      worktreePath,
      worktreeBranch: 'child',
      baseCommit,
      allowedOutputPaths: ['allowed.txt'],
    });

    expect(result).toEqual({
      status: 'rejected',
      integratedFiles: [],
      conflictedFiles: [],
      rejectedFiles: ['forbidden.txt'],
      error: 'files outside allowedOutputPaths: forbidden.txt',
    });
    await expect(readFile(join(projectPath, 'allowed.txt'), 'utf8')).resolves.toBe(
      'base allowed\n',
    );
    await expect(readFile(join(projectPath, 'forbidden.txt'), 'utf8')).resolves.toBe(
      'base forbidden\n',
    );
  });

  it('rejects an unsafe base ref before invoking git', async () => {
    await expect(
      integrateWorktreeChanges({
        projectPath: '/tmp/project',
        worktreePath: '/tmp/project/.child-worktree',
        worktreeBranch: 'child',
        baseCommit: '--output=/tmp/unsafe',
      }),
    ).rejects.toThrow('ref has invalid characters');
  });
});
