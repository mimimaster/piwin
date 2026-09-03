/**
 * Resolve whether a path lives inside a git work tree and locate the root.
 */
import { resolve } from 'node:path';
import type { GitRepositoryIdentity } from '@piwin/contracts';
import { runGitCommand } from './git-command-runner.js';

export async function probeGitRepository(projectPath: string): Promise<GitRepositoryIdentity> {
  const absoluteProjectPath = resolve(projectPath);
  const result = await runGitCommand({
    cwd: absoluteProjectPath,
    args: ['rev-parse', '--show-toplevel'],
    allowFailure: true,
  });

  if (result.exitCode !== 0) {
    return {
      rootPath: absoluteProjectPath,
      isRepository: false,
    };
  }

  const rootPath = result.stdout.trim();
  if (!rootPath) {
    return {
      rootPath: absoluteProjectPath,
      isRepository: false,
    };
  }

  const identity: GitRepositoryIdentity = {
    rootPath: resolve(rootPath),
    isRepository: true,
  };

  const meta = await runGitCommand({
    cwd: identity.rootPath,
    args: ['rev-parse', '--git-common-dir', '--git-dir'],
    allowFailure: true,
  });
  if (meta.exitCode === 0) {
    const lines = meta.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    const commonDirRaw = lines[0];
    const gitDirRaw = lines[1];
    if (commonDirRaw) {
      identity.commonDir = resolve(identity.rootPath, commonDirRaw);
    }
    if (commonDirRaw && gitDirRaw) {
      identity.isPrimaryWorktree =
        resolve(identity.rootPath, gitDirRaw) === resolve(identity.rootPath, commonDirRaw);
    }
  }

  return identity;
}
