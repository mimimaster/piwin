/**
 * Freeze a child worktree as Git objects inside the parent repository.
 *
 * The CAS snapshot (`freezeWorktreeAgainstBase`) only models regular file
 * bytes, so symlinks, executable bits and oversized blobs make its coverage
 * incomplete. A tree written from a temporary index carries all of that
 * exactly, and a commit on top of the lease base commit makes the result
 * reachable from `refs/piwin/results/<resultId>`.
 *
 * Reachability matters twice over:
 *  - the result stays integrable after the child copy is released or removed;
 *  - the lease `baseCommit` stays alive after the parent branch is amended,
 *    rebased or reset, so a continuation can still restore its own baseline.
 *
 * Objects live in the repository's shared object database, which linked
 * worktrees already use, so a tree written from the child copy is readable
 * from the parent repository.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGitCommand } from '../git-command-runner.js';
import { assertSafeRef } from '../path-safety.js';

const SNAPSHOT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const SNAPSHOT_TIMEOUT_MS = 60_000;
/** Fixed identity so a freeze never depends on the user's git config. */
const SNAPSHOT_IDENTITY = {
  GIT_AUTHOR_NAME: 'piwin',
  GIT_AUTHOR_EMAIL: 'piwin@localhost',
  GIT_COMMITTER_NAME: 'piwin',
  GIT_COMMITTER_EMAIL: 'piwin@localhost',
} as const;

/** `resultId` reaches a ref name, so anything outside this set is folded away. */
function sanitizeResultId(resultId: string): string {
  const cleaned = resultId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!cleaned) {
    throw new Error('result id is empty after sanitize');
  }
  return cleaned;
}

/** Ref that keeps one frozen child result (and its base) reachable. */
export function resultSnapshotRefName(resultId: string): string {
  return `refs/piwin/results/${sanitizeResultId(resultId)}`;
}

/**
 * Write the child copy's current contents as a tree.
 *
 * `add --all` runs against an alternate index initialised from `baseCommit`,
 * so the child's real index stays untouched and installed dependencies or
 * build output never enter the tree (they are ignored, not staged).
 * `--no-renames` keeps the write a pure function of path contents, which is
 * what makes tree-OID comparison between freezing and integrating valid.
 */
export async function writeWorktreeResultTree(input: {
  worktreePath: string;
  baseCommit: string;
}): Promise<{ tree: string }> {
  const baseCommit = assertSafeRef(input.baseCommit);
  const indexDirectory = await mkdtemp(join(tmpdir(), 'piwin-snapshot-index-'));
  const indexEnvironment = { GIT_INDEX_FILE: join(indexDirectory, 'index') };
  try {
    await runGitCommand({
      cwd: input.worktreePath,
      args: ['read-tree', baseCommit],
      env: indexEnvironment,
    });
    await runGitCommand({
      cwd: input.worktreePath,
      args: ['add', '--all', '--', '.'],
      env: indexEnvironment,
      maxBufferBytes: SNAPSHOT_MAX_BUFFER_BYTES,
      timeoutMs: SNAPSHOT_TIMEOUT_MS,
    });
    const written = await runGitCommand({
      cwd: input.worktreePath,
      args: ['write-tree'],
      env: indexEnvironment,
    });
    const tree = written.stdout.trim();
    if (!tree) {
      throw new Error('git write-tree produced no tree');
    }
    return { tree: assertSafeRef(tree) };
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}

/**
 * Commit a frozen tree on top of its base and point `refs/piwin/results/<id>`
 * at it. The commit is a plumbing object: not on any branch, never shown as
 * history, only a reachability anchor.
 */
export async function commitResultSnapshot(input: {
  repoPath: string;
  tree: string;
  baseCommit: string;
  resultId: string;
}): Promise<{ tree: string; commit: string; ref: string }> {
  const tree = assertSafeRef(input.tree);
  const baseCommit = assertSafeRef(input.baseCommit);
  const ref = resultSnapshotRefName(input.resultId);
  assertSafeRef(ref);
  const created = await runGitCommand({
    cwd: input.repoPath,
    args: [
      'commit-tree',
      tree,
      '-p',
      baseCommit,
      '-m',
      `piwin subagent result ${input.resultId}`,
    ],
    env: SNAPSHOT_IDENTITY,
    maxBufferBytes: SNAPSHOT_MAX_BUFFER_BYTES,
  });
  const commit = created.stdout.trim();
  if (!commit) {
    throw new Error('git commit-tree produced no commit');
  }
  await runGitCommand({
    cwd: input.repoPath,
    args: ['update-ref', ref, commit],
  });
  return { tree, commit: assertSafeRef(commit), ref };
}

/** Drop one result ref. Objects may then be pruned by a later gc. */
export async function deleteResultSnapshotRef(input: {
  repoPath: string;
  resultId: string;
}): Promise<void> {
  const ref = resultSnapshotRefName(input.resultId);
  await runGitCommand({
    cwd: input.repoPath,
    args: ['update-ref', '-d', ref],
    allowFailure: true,
  });
}

/**
 * Restore a frozen tree into a worktree working directory.
 *
 * Callers reset the worktree to the tree's base commit first (see
 * `resetWorktreeToBase`): after that the index equals the base, so
 * `read-tree -u --reset` turns the tree delta into the exact file set the
 * child ended with. Untracked leftovers from a previous task are already gone
 * because the reset cleaned them.
 */
export async function checkoutWorktreeTree(input: {
  worktreePath: string;
  tree: string;
}): Promise<void> {
  const tree = assertSafeRef(input.tree);
  await runGitCommand({
    cwd: input.worktreePath,
    args: ['read-tree', '-u', '--reset', tree],
    maxBufferBytes: SNAPSHOT_MAX_BUFFER_BYTES,
    timeoutMs: SNAPSHOT_TIMEOUT_MS,
  });
}
