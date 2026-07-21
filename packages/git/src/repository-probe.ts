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

  return {
    rootPath: resolve(rootPath),
    isRepository: true,
  };
}
