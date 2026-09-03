/**
 * Cheap git identity for project/list enrichment (sidebar repo grouping).
 * Not a full status snapshot — no dirty-file walk.
 */
import { createHash } from 'node:crypto';
import { probeGitRepository } from './repository-probe.js';
import { runGitCommand } from './git-command-runner.js';

export type GitWorkspaceListing = {
  gitRepositoryId: string;
  isPrimaryWorktree: boolean;
  currentBranch: string | null;
};

export function gitRepositoryIdFromCommonDir(commonDir: string): string {
  return createHash('sha256').update(commonDir).digest('hex').slice(0, 16);
}

export async function readGitWorkspaceListing(
  projectPath: string,
): Promise<GitWorkspaceListing | null> {
  try {
    const identity = await probeGitRepository(projectPath);
    if (!identity.isRepository || !identity.commonDir) {
      return null;
    }
    const currentBranch = await readCurrentBranchLabel(identity.rootPath);
    return {
      gitRepositoryId: gitRepositoryIdFromCommonDir(identity.commonDir),
      isPrimaryWorktree: identity.isPrimaryWorktree === true,
      currentBranch,
    };
  } catch {
    return null;
  }
}

async function readCurrentBranchLabel(rootPath: string): Promise<string | null> {
  const attached = await runGitCommand({
    cwd: rootPath,
    args: ['branch', '--show-current'],
    allowFailure: true,
  });
  if (attached.exitCode === 0) {
    const name = attached.stdout.trim();
    if (name.length > 0) {
      return name;
    }
  }
  const shortHead = await runGitCommand({
    cwd: rootPath,
    args: ['rev-parse', '--short', 'HEAD'],
    allowFailure: true,
  });
  if (shortHead.exitCode !== 0) {
    return null;
  }
  const short = shortHead.stdout.trim();
  return short.length > 0 ? `HEAD ${short}` : null;
}
