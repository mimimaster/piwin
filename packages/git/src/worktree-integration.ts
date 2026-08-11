/**
 * CE-SUB-ORCH: three-way worktree integration for parallel writes.
 *
 * Integrates changes from a child worktree back to the parent branch. Uses
 * diff + apply (not `git checkout <branch> -- <paths>`) so the parent branch
 * history is preserved. Detects file overlap conflicts when multiple children
 * touch the same file.
 */

import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { runGitCommand } from './git-command-runner.js';
import { assertSafeRef } from './path-safety.js';

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

/**
 * Integrate a child worktree's changes into the parent branch using diff +
 * apply. This is a serialized operation — the caller must ensure no other
 * integration is running concurrently.
 */
export async function integrateWorktreeChanges(
  input: WorktreeIntegrationInput,
): Promise<WorktreeIntegrationResult> {
  const { projectPath, worktreePath, allowedOutputPaths } = input;
  const baseCommit = assertSafeRef(input.baseCommit);
  const rejectedFiles: string[] = [];

  // Build a complete child snapshot in an alternate index. This captures
  // committed, unstaged, and untracked files without changing the child's real
  // index (which must remain inspectable if integration is rejected/conflicted).
  let changedFiles: string[];
  let childPatch: string;
  const childIndexDirectory = await mkdtemp(join(tmpdir(), 'piwin-child-index-'));
  const childIndexPath = join(childIndexDirectory, 'index');
  const childIndexEnvironment = { GIT_INDEX_FILE: childIndexPath };
  try {
    await runGitCommand({
      cwd: worktreePath,
      args: ['read-tree', baseCommit],
      env: childIndexEnvironment,
    });
    await runGitCommand({
      cwd: worktreePath,
      args: ['add', '--all', '--', '.'],
      env: childIndexEnvironment,
    });
    const changedFilesResult = await runGitCommand({
      cwd: worktreePath,
      args: ['diff', '--cached', '--name-status', '-z', '--find-renames', baseCommit, '--'],
      env: childIndexEnvironment,
      maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
    });
    changedFiles = parseChangedFiles(changedFilesResult.stdout);
    const diffOutput = await runGitCommand({
      cwd: worktreePath,
      args: ['diff', '--cached', baseCommit, '--binary', '--full-index', '--'],
      env: childIndexEnvironment,
      maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
    });
    childPatch = diffOutput.stdout;
  } catch (error) {
    return {
      status: 'conflict',
      integratedFiles: [],
      conflictedFiles: [],
      rejectedFiles: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(childIndexDirectory, { recursive: true, force: true });
  }

  // Check allowedOutputPaths.
  if (allowedOutputPaths && allowedOutputPaths.length > 0) {
    const allowed = new Set(allowedOutputPaths.map((p) => p.replace(/^\.\//, '')));
    for (const file of changedFiles) {
      if (!allowed.has(file)) {
        rejectedFiles.push(file);
      }
    }
    if (rejectedFiles.length > 0) {
      return {
        status: 'rejected',
        integratedFiles: [],
        conflictedFiles: [],
        rejectedFiles,
        error: `files outside allowedOutputPaths: ${rejectedFiles.join(', ')}`,
      };
    }
  }

  if (!childPatch.trim()) {
    return {
      status: 'applied',
      integratedFiles: changedFiles,
      conflictedFiles: [],
      rejectedFiles: [],
    };
  }

  // Compute the three-way result in an alternate copy of the parent's index.
  // Only after that succeeds do we apply the resulting delta to the working
  // tree without `--index`. The user's real staging area is never modified.
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
      await runGitCommand({
        cwd: projectPath,
        args: ['apply', parentPatchPath],
        maxBufferBytes: INTEGRATION_MAX_BUFFER_BYTES,
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
