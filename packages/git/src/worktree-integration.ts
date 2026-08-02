/**
 * CE-SUB-ORCH: three-way worktree integration for parallel writes.
 *
 * Integrates changes from a child worktree back to the parent branch. Uses
 * diff + apply (not `git checkout <branch> -- <paths>`) so the parent branch
 * history is preserved. Detects file overlap conflicts when multiple children
 * touch the same file.
 */

import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand } from './git-command-runner.js';
import { diffWorktreeAgainstMain } from './worktree.js';

export type WorktreeIntegrationInput = {
  /** Parent project path (main worktree). */
  projectPath: string;
  /** Child worktree path. */
  worktreePath: string;
  /** Child worktree branch. */
  worktreeBranch: string;
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

  // Get the diff between the worktree branch and the main branch.
  const diff = await diffWorktreeAgainstMain({
    projectPath,
    worktreePath,
  });

  const changedFiles = diff.files.map((f) => f.path);
  const rejectedFiles: string[] = [];
  const integratedFiles: string[] = [];

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

  // Apply the diff to the parent branch.
  // We write the diff to a temp file and use `git apply --3way` rather than
  // `git checkout <branch> -- <paths>` to preserve parent branch history.
  try {
    const diffOutput = await runGitCommand({
      cwd: worktreePath,
      args: ['diff', 'HEAD~1', '--binary'],
    });

    if (diffOutput.stdout.trim()) {
      const patchPath = join(projectPath, `.piwin-patch-${Date.now().toString(36)}.diff`);
      await writeFile(patchPath, diffOutput.stdout, 'utf8');
      try {
        await runGitCommand({
          cwd: projectPath,
          args: ['apply', '--3way', patchPath],
        });
      } finally {
        await unlink(patchPath).catch(() => {});
      }
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
  }
}

/**
 * Check whether the parent working directory has uncommitted changes.
 * Used by the workspace service when `requireCleanBaseForParallelWrites` is true.
 */
export async function isWorktreeBaseClean(projectPath: string): Promise<boolean> {
  try {
    const result = await runGitCommand({
      cwd: projectPath,
      args: ['status', '--porcelain'],
    });
    return result.stdout.trim().length === 0;
  } catch {
    // Not a git repo or git unavailable — treat as not clean.
    return false;
  }
}
