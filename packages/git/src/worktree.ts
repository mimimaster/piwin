/**
 * CE-SUB: git worktree helpers for isolated sub-agent sandboxes.
 * Uses git-native worktrees under <repo>/.piwin-worktrees/<name>.
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { runGitCommand } from './git-command-runner.js';
import { assertSafeBranchName } from './path-safety.js';

export type CreateWorktreeInput = {
  projectPath: string;
  /** Sanitized id used in path/branch (e.g. child session id). */
  name: string;
  baseRef?: string;
};

export type CreateWorktreeResult = {
  worktreePath: string;
  branch: string;
};

export type RemoveWorktreeInput = {
  projectPath: string;
  worktreePath: string;
  force?: boolean;
};

export type DiffWorktreeInput = {
  projectPath: string;
  worktreePath: string;
};

export type DiffWorktreeResult = {
  files: Array<{ path: string; status: string }>;
  raw: string;
};

export type ApplyWorktreeInput = {
  projectPath: string;
  worktreePath: string;
  /** Relative paths under project; when set only these are applied via checkout. */
  allowedOutputPaths?: string[];
};

export type ApplyWorktreeResult = {
  appliedPaths: string[];
  strategy: 'checkout-paths' | 'none';
};

function sanitizeWorktreeName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!cleaned) {
    throw new Error('worktree name is empty after sanitize');
  }
  return cleaned;
}

export async function createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
  const projectPath = resolve(input.projectPath);
  const safeName = sanitizeWorktreeName(input.name);
  const branch = `piwin/subagent/${safeName}`;
  assertSafeBranchName(branch);
  const worktreeRoot = join(projectPath, '.piwin-worktrees');
  await mkdir(worktreeRoot, { recursive: true });
  const worktreePath = join(worktreeRoot, safeName);
  const baseRef = input.baseRef?.trim() || 'HEAD';

  // Create branch from base, then add worktree. If branch exists, reuse with force flag carefully.
  const branchCheck = await runGitCommand({
    cwd: projectPath,
    args: ['rev-parse', '--verify', branch],
    allowFailure: true,
  });
  if (branchCheck.exitCode !== 0) {
    await runGitCommand({
      cwd: projectPath,
      args: ['branch', branch, baseRef],
    });
  }

  const add = await runGitCommand({
    cwd: projectPath,
    args: ['worktree', 'add', worktreePath, branch],
    allowFailure: true,
  });
  if (add.exitCode !== 0) {
    // Already exists / path taken — try force re-add after remove listing
    if (add.stderr.includes('already exists') || add.stdout.includes('already exists')) {
      return { worktreePath, branch };
    }
    throw new Error(`git worktree add failed: ${add.stderr || add.stdout}`);
  }
  return { worktreePath, branch };
}

export async function removeWorktree(input: RemoveWorktreeInput): Promise<void> {
  const projectPath = resolve(input.projectPath);
  const worktreePath = resolve(input.worktreePath);
  const args = ['worktree', 'remove'];
  if (input.force) {
    args.push('--force');
  }
  args.push(worktreePath);
  const result = await runGitCommand({
    cwd: projectPath,
    args,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    // Best-effort prune
    await runGitCommand({
      cwd: projectPath,
      args: ['worktree', 'prune'],
      allowFailure: true,
    });
    if (!result.stderr.includes('is not a working tree') && !result.stderr.includes('not a valid path')) {
      throw new Error(`git worktree remove failed: ${result.stderr || result.stdout}`);
    }
  }
}

export async function diffWorktreeAgainstMain(
  input: DiffWorktreeInput,
): Promise<DiffWorktreeResult> {
  const projectPath = resolve(input.projectPath);
  const worktreePath = resolve(input.worktreePath);
  const result = await runGitCommand({
    cwd: worktreePath,
    args: ['diff', '--name-status', `${projectPath}` === worktreePath ? 'HEAD' : 'HEAD'],
    allowFailure: true,
  });
  // Compare worktree working tree vs main branch tip
  const againstMain = await runGitCommand({
    cwd: worktreePath,
    args: ['diff', '--name-status', 'main...HEAD'],
    allowFailure: true,
  });
  const raw =
    againstMain.exitCode === 0 && againstMain.stdout.trim()
      ? againstMain.stdout
      : (
          await runGitCommand({
            cwd: worktreePath,
            args: ['diff', '--name-status', 'master...HEAD'],
            allowFailure: true,
          })
        ).stdout ||
        (
          await runGitCommand({
            cwd: worktreePath,
            args: ['status', '--porcelain'],
            allowFailure: true,
          })
        ).stdout;

  const files: Array<{ path: string; status: string }> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // name-status: "M\tpath" or porcelain " M path"
    if (trimmed.includes('\t')) {
      const [status, path] = trimmed.split('\t');
      if (status && path) files.push({ status: status.trim(), path: path.trim() });
    } else if (trimmed.length > 3) {
      files.push({ status: trimmed.slice(0, 2).trim() || 'M', path: trimmed.slice(3).trim() });
    }
  }
  return { files, raw };
}

/**
 * Apply changed files from worktree into main project working tree via `git checkout <branch> -- paths`.
 * Does not create a commit.
 */
export async function applyWorktreeToMain(input: ApplyWorktreeInput): Promise<ApplyWorktreeResult> {
  const projectPath = resolve(input.projectPath);
  const worktreePath = resolve(input.worktreePath);
  const diff = await diffWorktreeAgainstMain({ projectPath, worktreePath });
  let paths = diff.files.map((file) => file.path).filter(Boolean);
  if (input.allowedOutputPaths && input.allowedOutputPaths.length > 0) {
    const allow = new Set(input.allowedOutputPaths.map((item) => item.replace(/^\.\//, '')));
    paths = paths.filter((path) => allow.has(path.replace(/^\.\//, '')));
  }
  if (paths.length === 0) {
    return { appliedPaths: [], strategy: 'none' };
  }
  // Determine branch of worktree
  const branchResult = await runGitCommand({
    cwd: worktreePath,
    args: ['rev-parse', '--abbrev-ref', 'HEAD'],
  });
  const branch = branchResult.stdout.trim();
  await runGitCommand({
    cwd: projectPath,
    args: ['checkout', branch, '--', ...paths],
  });
  return { appliedPaths: paths, strategy: 'checkout-paths' };
}

export function worktreeDisplayName(worktreePath: string): string {
  return basename(worktreePath);
}
