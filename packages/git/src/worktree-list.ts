/**
 * List git worktrees and mark which local branches they occupy.
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  GitBranchListEntry,
  GitRepositoryIdentity,
  GitWorktreeEntry,
  GitWorktreeList,
} from '@piwin/contracts';
import { runGitCommand } from './git-command-runner.js';

const HEADS_PREFIX = 'refs/heads/';

type ParsedWorktreeRecord = {
  worktreePath: string;
  branch: string | null;
  headCommit: string;
  isPrimary: boolean;
  locked: boolean;
};

/**
 * Parse `git worktree list --porcelain`. Does not touch the filesystem.
 * Reachability is filled later by {@link listGitWorktrees}.
 */
export function parseGitWorktreeListPorcelain(stdout: string): ParsedWorktreeRecord[] {
  const records: ParsedWorktreeRecord[] = [];
  let current: ParsedWorktreeRecord | null = null;

  const flush = (): void => {
    if (current) {
      records.push(current);
      current = null;
    }
  };

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      const worktreePath = line.slice('worktree '.length).trim();
      if (!worktreePath) {
        continue;
      }
      current = {
        worktreePath,
        branch: null,
        headCommit: '',
        isPrimary: records.length === 0,
        locked: false,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith('HEAD ')) {
      current.headCommit = line.slice('HEAD '.length).trim();
      continue;
    }
    if (line === 'detached' || line.startsWith('detached ')) {
      current.branch = null;
      continue;
    }
    if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim();
      current.branch = ref.startsWith(HEADS_PREFIX) ? ref.slice(HEADS_PREFIX.length) : ref;
      continue;
    }
    if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true;
    }
  }
  flush();
  return records;
}

export function annotateBranchesWithWorktreeOccupancy(
  branches: readonly GitBranchListEntry[],
  worktrees: readonly GitWorktreeEntry[],
  currentWorktreePath: string,
): GitBranchListEntry[] {
  const currentPath = resolve(currentWorktreePath);
  const occupancy = new Map<string, GitWorktreeEntry>();
  for (const worktree of worktrees) {
    const branchName = worktree.branch;
    if (!branchName) {
      continue;
    }
    if (resolve(worktree.worktreePath) === currentPath) {
      continue;
    }
    if (!occupancy.has(branchName)) {
      occupancy.set(branchName, worktree);
    }
  }

  return branches.map((branch) => {
    const occupied = occupancy.get(branch.name);
    if (!occupied) {
      return branch;
    }
    const annotated: GitBranchListEntry = {
      name: branch.name,
      current: branch.current,
      shortHash: branch.shortHash,
      checkedOutWorktreePath: occupied.worktreePath,
    };
    if (!occupied.reachable) {
      annotated.checkedOutWorktreeMissing = true;
    }
    return annotated;
  });
}

async function isReachableDirectory(directoryPath: string): Promise<boolean> {
  try {
    const info = await stat(directoryPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function listGitWorktrees(
  repository: GitRepositoryIdentity,
): Promise<GitWorktreeList> {
  if (!repository.isRepository) {
    return { repository, worktrees: [] };
  }

  const result = await runGitCommand({
    cwd: repository.rootPath,
    args: ['worktree', 'list', '--porcelain'],
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return { repository, worktrees: [] };
  }

  const parsed = parseGitWorktreeListPorcelain(result.stdout);
  const worktrees: GitWorktreeEntry[] = await Promise.all(
    parsed.map(async (record) => ({
      worktreePath: record.worktreePath,
      branch: record.branch,
      headCommit: record.headCommit,
      isPrimary: record.isPrimary,
      locked: record.locked,
      reachable: await isReachableDirectory(record.worktreePath),
    })),
  );
  return { repository, worktrees };
}
