/**
 * Git write operations (stage/unstage/commit/branch/checkout).
 * No force-push, hard reset, or clean -fdx.
 */
import type {
  GitBranchCreateInput,
  GitCheckoutInput,
  GitCommitInput,
  GitMutationResult,
  GitStageInput,
  GitStashInput,
  GitUnstageInput,
} from '@piwin/contracts';
import { probeGitRepository } from './repository-probe.js';
import { GitCommandError, runGitCommand } from './git-command-runner.js';
import { formatGitCheckoutFailure } from './checkout-failure.js';
import {
  assertSafeBranchName,
  assertSafeCommitMessage,
  assertSafeRef,
  assertSafeRepoRelativePaths,
} from './path-safety.js';

async function requireRepo(projectPath: string): Promise<string> {
  const repository = await probeGitRepository(projectPath);
  if (!repository.isRepository) {
    throw new Error(`not a git repository: ${projectPath}`);
  }
  return repository.rootPath;
}

export async function stagePaths(input: GitStageInput): Promise<GitMutationResult> {
  const root = await requireRepo(input.projectPath);
  const paths = assertSafeRepoRelativePaths(root, input.paths);
  if (paths.length === 0) {
    await runGitCommand({ cwd: root, args: ['add', '-A'] });
    return { kind: 'stage', ok: true, message: 'staged all changes' };
  }
  await runGitCommand({ cwd: root, args: ['add', '--', ...paths] });
  return { kind: 'stage', ok: true, message: `staged ${paths.length} path(s)` };
}

export async function unstagePaths(input: GitUnstageInput): Promise<GitMutationResult> {
  const root = await requireRepo(input.projectPath);
  const paths = assertSafeRepoRelativePaths(root, input.paths);
  if (paths.length === 0) {
    // unstage all
    await runGitCommand({
      cwd: root,
      args: ['restore', '--staged', '.'],
      allowFailure: true,
    });
    // older git fallback
    await runGitCommand({
      cwd: root,
      args: ['reset', 'HEAD', '--', '.'],
      allowFailure: true,
    });
    return { kind: 'unstage', ok: true, message: 'unstaged all' };
  }
  const restore = await runGitCommand({
    cwd: root,
    args: ['restore', '--staged', '--', ...paths],
    allowFailure: true,
  });
  if (restore.exitCode !== 0) {
    await runGitCommand({ cwd: root, args: ['reset', 'HEAD', '--', ...paths] });
  }
  return { kind: 'unstage', ok: true, message: `unstaged ${paths.length} path(s)` };
}

export async function commitChanges(input: GitCommitInput): Promise<GitMutationResult> {
  const root = await requireRepo(input.projectPath);
  const message = assertSafeCommitMessage(input.message);
  const args = ['commit', '-m', message];
  if (input.allTracked === true) {
    args.splice(1, 0, '-a');
  }
  const result = await runGitCommand({ cwd: root, args, allowFailure: true });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'commit failed');
  }
  return { kind: 'commit', ok: true, message: 'commit created' };
}

export async function createBranch(input: GitBranchCreateInput): Promise<GitMutationResult> {
  const root = await requireRepo(input.projectPath);
  const name = assertSafeBranchName(input.name);
  const checkout = input.checkout !== false;
  if (checkout) {
    await runGitCommand({ cwd: root, args: ['checkout', '-b', name] });
    return { kind: 'branch-create', ok: true, message: `created and checked out ${name}` };
  }
  await runGitCommand({ cwd: root, args: ['branch', name] });
  return { kind: 'branch-create', ok: true, message: `created branch ${name}` };
}

export async function checkoutRef(input: GitCheckoutInput): Promise<GitMutationResult> {
  const root = await requireRepo(input.projectPath);
  const ref = assertSafeRef(input.ref);
  try {
    await runGitCommand({ cwd: root, args: ['checkout', ref] });
  } catch (error) {
    if (error instanceof GitCommandError) {
      throw new Error(formatGitCheckoutFailure(error.stderr, error.message));
    }
    throw error;
  }
  return { kind: 'checkout', ok: true, message: `checked out ${ref}` };
}

export async function stashChanges(input: GitStashInput): Promise<GitMutationResult> {
  const root = await requireRepo(input.projectPath);
  const message = assertSafeCommitMessage(
    input.message?.trim() || 'piwin: stash before conversation branch switch',
  );
  const result = await runGitCommand({
    cwd: root,
    args: ['stash', 'push', '-u', '-m', message],
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    const detail = `${result.stderr} ${result.stdout}`.toLowerCase();
    if (detail.includes('no local changes') || detail.includes('no changes added')) {
      return { kind: 'stash', ok: true, message: 'nothing to stash' };
    }
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'stash failed');
  }
  return { kind: 'stash', ok: true, message: 'stashed working tree' };
}
