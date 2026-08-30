import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import type { SubagentTaskResult, SubagentWorkspaceLease } from '@piwin/contracts';
import {
  createWorktree,
  integrateWorktreeChanges,
  isWorktreeBaseClean,
  removeWorktree,
  runGitCommand,
} from '@piwin/git';
import {
  createGitWorktreeIntegrationAdapter,
  createSubagentIntegrationCoordinator,
} from './subagent-integration-coordinator.js';

const temporaryRoots: string[] = [];

async function runGit(repositoryPath: string, args: string[]): Promise<string> {
  const result = await runGitCommand({ cwd: repositoryPath, args });
  return result.stdout.trim();
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it('applies an uncommitted new file, cleans its worktree, and removes its branch', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'piwin-host-git-integration-'));
  const storageRoot = await mkdtemp(join(tmpdir(), 'piwin-host-worktrees-'));
  temporaryRoots.push(projectPath, storageRoot);
  await runGit(projectPath, ['init', '-b', 'main']);
  await runGit(projectPath, ['config', 'user.email', 'piwin-test@example.com']);
  await runGit(projectPath, ['config', 'user.name', 'piwin test']);
  await writeFile(join(projectPath, 'README.md'), 'base\n');
  await runGit(projectPath, ['add', '--all']);
  await runGit(projectPath, ['commit', '-m', 'base']);
  const baseCommit = await runGit(projectPath, ['rev-parse', 'HEAD']);
  const worktree = await createWorktree({
    projectPath,
    name: 'uncommitted-new-file',
    baseRef: baseCommit,
    storageRoot,
  });
  await writeFile(join(worktree.worktreePath, 'game.js'), 'console.log("snake");\n');

  const lease: SubagentWorkspaceLease = {
    mode: 'worktree',
    cwd: worktree.worktreePath,
    parentRepoPath: projectPath,
    worktreePath: worktree.worktreePath,
    worktreeBranch: worktree.branch,
    baseCommit,
  };
  const taskResult: SubagentTaskResult = {
    runId: 'run-1',
    taskId: 'task-1',
    childSessionId: 'child-1',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'pending',
    allowedOutputPaths: ['game.js'],
    resultRef: { resultId: 'result-1', revision: 1 },
  };
  const coordinator = createSubagentIntegrationCoordinator({
    integrateWorktree: createGitWorktreeIntegrationAdapter(integrateWorktreeChanges),
    isBaseClean: isWorktreeBaseClean,
    removeWorktree: async (worktreePath, parentRepoPath, worktreeBranch) => {
      await removeWorktree({
        projectPath: parentRepoPath,
        worktreePath,
        force: true,
        ...(worktreeBranch ? { worktreeBranch } : {}),
      });
    },
  });

  const result = await coordinator.integrate(taskResult, lease);

  expect(result.integrationStatus).toBe('applied');
  expect(result.error).toBeUndefined();
  expect(result.changedFiles).toEqual(['game.js']);
  await expect(readFile(join(projectPath, 'game.js'), 'utf8')).resolves.toBe(
    'console.log("snake");\n',
  );
  await expect(readFile(join(worktree.worktreePath, 'game.js'), 'utf8')).rejects.toThrow();
  const branchCheck = await runGitCommand({
    cwd: projectPath,
    args: ['rev-parse', '--verify', worktree.branch],
    allowFailure: true,
  });
  expect(branchCheck.exitCode).not.toBe(0);
  expect(await runGit(projectPath, ['diff', '--cached', '--name-only'])).toBe('');
});
