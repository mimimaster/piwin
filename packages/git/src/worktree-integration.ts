/**
 * CE-SUB-ORCH: three-way child integration for serialized writes.
 *
 * Integrates changes from a child copy back to the parent branch. Uses
 * diff + apply (not `git checkout <branch> -- <paths>`) so the parent branch
 * history is preserved. Detects file overlap conflicts when the child touched
 * a file the parent also moved.
 *
 * A child result has two equally valid sources:
 *  - `readChildPatchFromWorktree` reads the live child copy (legacy path, and
 *    the path used when no frozen Git snapshot exists);
 *  - `readChildPatchFromTree` reads the frozen result tree, which is what the
 *    reviewer actually approved and what survives releasing the copy.
 *
 * Both produce the same patch, so `applyChildPatchToParent` is shared and the
 * parent-side write path is identical either way. The two sources are
 * compared by tree OID, not by patch bytes: patch text depends on rename
 * detection and diff heuristics, and is not a stable identity.
 */

import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { runGitCommand } from './git-command-runner.js';
import { assertSafeRef } from './path-safety.js';
import { applyTreeDiffToWorkspace } from './turn-changes/apply-tree-diff.js';
import { createTurnChangeObjectStore } from './turn-changes/object-store.js';

const INTEGRATION_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export type WorktreeIntegrationInput = {
  /** Parent project path (main worktree). */
  projectPath: string;
  /** Child worktree path. */
  worktreePath: string;
  /** Child worktree branch. */
  worktreeBranch: string;
  /** Exact parent commit captured before the child worktree was created. */
  baseCommit: string;
  /** Allowed output paths (relative to project root). When set, files
   * outside this list are rejected. */
  allowedOutputPaths?: string[];
};

export type SnapshotIntegrationInput = {
  /** Parent project path (main worktree). */
  projectPath: string;
  /** Exact parent commit captured before the child worktree was created. */
  baseCommit: string;
  /** Frozen child result tree (`SubagentGitSnapshot.tree`). */
  childTree: string;
  /** Allowed output paths (relative to project root). When set, files
   * outside this list are rejected. */
  allowedOutputPaths?: string[];
};

export type WorktreeIntegrationResult = {
  status: 'applied' | 'conflict' | 'rejected';
  /** Files that were integrated (relative to project root). */
  integratedFiles: string[];
  /** Files that conflicted (relative to project root). */
  conflictedFiles: string[];
  /** Files rejected because they were outside allowedOutputPaths. */
  rejectedFiles: string[];
  /** Error message when status is 'rejected'. */
  error?: string;
};

/** A child's changes as a parent-applicable patch plus the file list. */
export type ChildChangePatch = {
  changedFiles: string[];
  childPatch: string;
};

/**
 * Read the child copy's changes as a patch against `baseCommit`.
 *
 * An alternate index captures committed, unstaged and untracked files without
 * changing the child's real index (which must remain inspectable if the
 * integration is rejected or conflicted).
 */
export async function readChildPatchFromWorktree(input: {
  worktreePath: string;
  baseCommit: string;
}): Promise<ChildChangePatch> {
  const baseCommit = assertSafeRef(input.baseCommit);
  const childIndexDirectory = await mkdtemp(join(tmpdir(), 'piwin-child-index-'));
  const childIndexEnvironment = { GIT_INDEX_FILE: join(childIndexDirectory, 'index') };
  try {
    await runGitCommand({
      cwd: input.worktreePath,
      args: ['read-tree', baseCommit],
      env: childIndexEnvironment,
    });
    await runGitCommand({
      cwd: input.worktreePath,
      args: ['add', '--all', '--', '.'],
      env: childIndexEnvironment,
      maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
    });
    const changedFilesResult = await runGitCommand({
      cwd: input.worktreePath,
      args: ['diff', '--cached', '--name-status', '-z', '--find-renames', baseCommit, '--'],
      env: childIndexEnvironment,
      maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
    });
    const diffOutput = await runGitCommand({
      cwd: input.worktreePath,
      args: ['diff', '--cached', baseCommit, '--binary', '--full-index', '--'],
      env: childIndexEnvironment,
      maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
    });
    return {
      changedFiles: parseChangedFiles(changedFilesResult.stdout),
      childPatch: diffOutput.stdout,
    };
  } finally {
    await rm(childIndexDirectory, { recursive: true, force: true });
  }
}

/**
 * Read a frozen result tree's changes as a patch against `baseCommit`.
 *
 * Reads only Git objects, so it works after the child copy is gone.
 */
export async function readChildPatchFromTree(input: {
  projectPath: string;
  baseCommit: string;
  childTree: string;
}): Promise<ChildChangePatch> {
  const baseCommit = assertSafeRef(input.baseCommit);
  const childTree = assertSafeRef(input.childTree);
  const changedFilesResult = await runGitCommand({
    cwd: input.projectPath,
    args: ['diff', '--name-status', '-z', '--find-renames', baseCommit, childTree, '--'],
    maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
  });
  const diffOutput = await runGitCommand({
    cwd: input.projectPath,
    args: ['diff', baseCommit, childTree, '--binary', '--full-index', '--'],
    maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
  });
  return {
    changedFiles: parseChangedFiles(changedFilesResult.stdout),
    childPatch: diffOutput.stdout,
  };
}

/**
 * Apply a child patch to the parent branch.
 *
 * Computes the three-way result in an alternate copy of the parent's index and
 * only then writes the resulting delta through the bounded writer, so the
 * user's real staging area is never modified.
 */
export async function applyChildPatchToParent(input: {
  projectPath: string;
  baseCommit: string;
  changedFiles: string[];
  childPatch: string;
  allowedOutputPaths?: readonly string[];
}): Promise<WorktreeIntegrationResult> {
  const { projectPath, changedFiles } = input;
  const allowedOutputPaths = input.allowedOutputPaths;
  const childPatch = input.childPatch;

  const rejected = rejectDisallowedOutputPaths(changedFiles, allowedOutputPaths);
  if (rejected) return rejected;

  if (!childPatch.trim()) {
    return {
      status: 'applied',
      integratedFiles: changedFiles,
      conflictedFiles: [],
      rejectedFiles: [],
    };
  }

  const integrationDirectory = await mkdtemp(join(tmpdir(), 'piwin-parent-index-'));
  const temporaryIndexPath = join(integrationDirectory, 'index');
  const childPatchPath = join(integrationDirectory, 'child.patch');
  const parentPatchPath = join(integrationDirectory, 'parent.patch');
  const parentIndexEnvironment = { GIT_INDEX_FILE: temporaryIndexPath };
  try {
    const indexPathResult = await runGitCommand({
      cwd: projectPath,
      args: ['rev-parse', '--git-path', 'index'],
    });
    const reportedIndexPath = indexPathResult.stdout.trim();
    const parentIndexPath = isAbsolute(reportedIndexPath)
      ? reportedIndexPath
      : resolve(projectPath, reportedIndexPath);
    await copyFile(parentIndexPath, temporaryIndexPath);
    await writeFile(childPatchPath, childPatch, 'utf8');

    const beforeTreeResult = await runGitCommand({
      cwd: projectPath,
      args: ['write-tree'],
      env: parentIndexEnvironment,
    });
    const beforeTree = assertSafeRef(beforeTreeResult.stdout.trim());

    const mergeResult = await runGitCommand({
      cwd: projectPath,
      args: ['apply', '--3way', '--cached', childPatchPath],
      env: parentIndexEnvironment,
      allowFailure: true,
      maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
    });
    if (mergeResult.exitCode !== 0) {
      return conflictResult(changedFiles, mergeResult.stderr || mergeResult.stdout);
    }

    const afterTreeResult = await runGitCommand({
      cwd: projectPath,
      args: ['write-tree'],
      env: parentIndexEnvironment,
    });
    const afterTree = assertSafeRef(afterTreeResult.stdout.trim());
    const parentDiff = await runGitCommand({
      cwd: projectPath,
      args: ['diff', beforeTree, afterTree, '--binary', '--full-index', '--'],
      maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
    });

    if (parentDiff.stdout.trim()) {
      await writeFile(parentPatchPath, parentDiff.stdout, 'utf8');
      const checkResult = await runGitCommand({
        cwd: projectPath,
        args: ['apply', '--check', parentPatchPath],
        allowFailure: true,
        maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
      });
      if (checkResult.exitCode !== 0) {
        return conflictResult(changedFiles, checkResult.stderr || checkResult.stdout);
      }
      const objectStore = createTurnChangeObjectStore({
        rootDir: join(integrationDirectory, 'turn-change-objects'),
      });
      await applyTreeDiffToWorkspace({
        workspaceRoot: projectPath,
        beforeTree,
        afterTree,
        store: objectStore,
      });
    }

    return {
      status: 'applied',
      integratedFiles: changedFiles,
      conflictedFiles: [],
      rejectedFiles: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'conflict',
      integratedFiles: [],
      conflictedFiles: changedFiles,
      rejectedFiles: [],
      error: message,
    };
  } finally {
    await rm(integrationDirectory, { recursive: true, force: true });
  }
}

/**
 * Integrate the child copy's changes. This is a serialized operation — the
 * caller must ensure no other integration is running concurrently.
 */
export async function integrateWorktreeChanges(
  input: WorktreeIntegrationInput,
): Promise<WorktreeIntegrationResult> {
  // Validate the ref before the guarded read: an unsafe base commit is a
  // caller error, not a child conflict, so it must reject instead of being
  // reported as a failed integration.
  assertSafeRef(input.baseCommit);
  let patch: ChildChangePatch;
  try {
    patch = await readChildPatchFromWorktree({
      worktreePath: input.worktreePath,
      baseCommit: input.baseCommit,
    });
  } catch (error) {
    return {
      status: 'conflict',
      integratedFiles: [],
      conflictedFiles: [],
      rejectedFiles: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return applyChildPatchToParent({
    projectPath: input.projectPath,
    baseCommit: input.baseCommit,
    changedFiles: patch.changedFiles,
    childPatch: patch.childPatch,
    ...(input.allowedOutputPaths !== undefined
      ? { allowedOutputPaths: input.allowedOutputPaths }
      : {}),
  });
}

/**
 * Integrate a frozen result tree. Same parent write path as
 * `integrateWorktreeChanges`; the child copy is not required to exist.
 */
export async function integrateSnapshotChanges(
  input: SnapshotIntegrationInput,
): Promise<WorktreeIntegrationResult> {
  assertSafeRef(input.baseCommit);
  assertSafeRef(input.childTree);
  let patch: ChildChangePatch;
  try {
    patch = await readChildPatchFromTree({
      projectPath: input.projectPath,
      baseCommit: input.baseCommit,
      childTree: input.childTree,
    });
  } catch (error) {
    return {
      status: 'conflict',
      integratedFiles: [],
      conflictedFiles: [],
      rejectedFiles: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return applyChildPatchToParent({
    projectPath: input.projectPath,
    baseCommit: input.baseCommit,
    changedFiles: patch.changedFiles,
    childPatch: patch.childPatch,
    ...(input.allowedOutputPaths !== undefined
      ? { allowedOutputPaths: input.allowedOutputPaths }
      : {}),
  });
}

function rejectDisallowedOutputPaths(
  changedFiles: string[],
  allowedOutputPaths: readonly string[] | undefined,
): WorktreeIntegrationResult | undefined {
  // `undefined` means unrestricted; an explicit empty list denies everything.
  if (allowedOutputPaths === undefined) return undefined;
  const allowed = new Set(allowedOutputPaths.map((p) => p.replace(/^\.\//, '')));
  const rejectedFiles = changedFiles.filter((file) => !allowed.has(file));
  if (rejectedFiles.length === 0) return undefined;
  return {
    status: 'rejected',
    integratedFiles: [],
    conflictedFiles: [],
    rejectedFiles,
    error: `files outside allowedOutputPaths: ${rejectedFiles.join(', ')}`,
  };
}

function parseChangedFiles(nameStatusOutput: string): string[] {
  const fields = nameStatusOutput.split('\0');
  const changedFiles = new Set<string>();
  let fieldIndex = 0;

  while (fieldIndex < fields.length) {
    const status = fields[fieldIndex];
    fieldIndex += 1;
    if (!status) continue;

    const sourcePath = fields[fieldIndex];
    fieldIndex += 1;
    if (!sourcePath) continue;
    changedFiles.add(sourcePath);

    if (status.startsWith('R') || status.startsWith('C')) {
      const destinationPath = fields[fieldIndex];
      fieldIndex += 1;
      if (destinationPath) changedFiles.add(destinationPath);
    }
  }

  return [...changedFiles];
}

function conflictResult(changedFiles: string[], error: string): WorktreeIntegrationResult {
  return {
    status: 'conflict',
    integratedFiles: [],
    conflictedFiles: changedFiles,
    rejectedFiles: [],
    error: error.trim() || 'git could not apply the child changes',
  };
}

/**
 * Check whether the parent working directory has uncommitted changes.
 * Used by the workspace service when the dirty-base policy requires a check.
 */
export async function isWorktreeBaseClean(projectPath: string): Promise<boolean> {
  try {
    const result = await runGitCommand({
      cwd: projectPath,
      args: [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        '.',
        ':(exclude).piwin-worktrees',
        ':(exclude).piwin-worktrees/**',
      ],
    });
    return result.stdout.trim().length === 0;
  } catch {
    // Not a git repo or git unavailable — treat as not clean.
    return false;
  }
}
