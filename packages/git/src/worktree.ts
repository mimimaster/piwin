/**
 * CE-SUB: git worktree helpers for isolated sub-agent sandboxes.
 * Uses git-native worktrees under product-owned storage when supplied, with a
 * repository-local fallback for standalone callers.
 */
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { runGitCommand } from './git-command-runner.js';
import { assertSafeBranchName } from './path-safety.js';

export type CreateWorktreeInput = {
  projectPath: string;
  /** Sanitized id used in path/branch (e.g. child session id). */
  name: string;
  baseRef?: string;
  /** Product-owned root for worktree checkouts (for example ~/.piwin/worktrees). */
  storageRoot?: string;
};

export type CreateWorktreeResult = {
  worktreePath: string;
  branch: string;
};

export type RemoveWorktreeInput = {
  projectPath: string;
  worktreePath: string;
  force?: boolean;
  /** Generated branch to remove after the worktree is removed. */
  worktreeBranch?: string;
};

export type DiffWorktreeInput = {
  projectPath: string;
  worktreePath: string;
};

export type DiffWorktreeResult = {
  files: Array<{ path: string; status: string }>;
  raw: string;
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
  const repositoryKey = createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
  const worktreeRoot = input.storageRoot
    ? join(resolve(input.storageRoot), repositoryKey)
    : join(projectPath, '.piwin-worktrees');
  await mkdir(worktreeRoot, { recursive: true });
  const worktreePath = join(worktreeRoot, safeName);
  const baseRef = input.baseRef?.trim() || 'HEAD';

  // Create the generated branch from the captured base, then attach its worktree.
  const branchCheck = await runGitCommand({
    cwd: projectPath,
    args: ['rev-parse', '--verify', branch],
    allowFailure: true,
  });
  const createdBranch = branchCheck.exitCode !== 0;
  if (createdBranch) {
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
    if (createdBranch) {
      await runGitCommand({
        cwd: projectPath,
        args: ['branch', '--delete', '--force', branch],
        allowFailure: true,
      });
    }
    // Never adopt an existing path blindly: it may belong to a retained task
    // from an earlier Host process and can have a different base or owner.
    if (add.stderr.includes('already exists') || add.stdout.includes('already exists')) {
      throw new Error(`git worktree path already exists and was not reused: ${worktreePath}`);
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
    if (
      !result.stderr.includes('is not a working tree') &&
      !result.stderr.includes('not a valid path')
    ) {
      throw new Error(`git worktree remove failed: ${result.stderr || result.stdout}`);
    }
  }

  if (input.worktreeBranch) {
    const branch = assertSafeBranchName(input.worktreeBranch);
    if (!branch.startsWith('piwin/subagent/')) {
      throw new Error(`refusing to delete non-subagent worktree branch: ${branch}`);
    }
    const branchRemoval = await runGitCommand({
      cwd: projectPath,
      args: ['branch', '--delete', '--force', branch],
      allowFailure: true,
    });
    if (
      branchRemoval.exitCode !== 0 &&
      !branchRemoval.stderr.includes('branch not found') &&
      !branchRemoval.stderr.includes('not found')
    ) {
      throw new Error(
        `git worktree branch cleanup failed: ${branchRemoval.stderr || branchRemoval.stdout}`,
      );
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

export function worktreeDisplayName(worktreePath: string): string {
  return basename(worktreePath);
}
