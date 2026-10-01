/**
 * Resolve which checkout a write subagent starts from and reports back to.
 *
 * The writer slot used to branch from `HEAD` of the project root only. A lead
 * that works on a feature branch in its own linked worktree therefore handed
 * every child a base the lead was no longer on, and an applied result landed
 * in the wrong tree. This module turns "the branch the lead is on" into the
 * worktree that has it checked out, so the lease can record both the base
 * commit and the apply target.
 *
 * The model supplies a branch name, never a path: workspace paths stay a
 * Host-only fact (see `FORBIDDEN_START_FIELDS` in the tool input parser).
 */
import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { GitWorktreeEntry } from '@piwin/contracts';
import { listGitWorktrees, runGitCommand } from '@piwin/git';

import { isWriterSlotBranch, isWriterSlotWorktreePath } from './subagent-writer-slots.js';

const SUBAGENT_BRANCH_PREFIX = 'piwin/subagent/';

export class SubagentBaseCheckoutError extends Error {
  override name = 'SubagentBaseCheckoutError';
}

export type SubagentBaseCheckout = {
  /** Linked worktree (never the project root) the child is based on. */
  targetPath: string;
  /** Branch checked out there; null for a detached HEAD. */
  branch: string | null;
  /** Tip of that checkout at the moment of resolution. */
  baseCommit: string;
};

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** Product-owned copies (writer slot, per-task copies) are never a lead's checkout. */
function isProductOwnedCheckout(entry: GitWorktreeEntry): boolean {
  if (entry.branch !== null && entry.branch.startsWith(SUBAGENT_BRANCH_PREFIX)) return true;
  return isWriterSlotBranch(entry.branch) || isWriterSlotWorktreePath(entry.worktreePath);
}

function normalizeBranchName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith('refs/heads/') ? trimmed.slice('refs/heads/'.length) : trimmed;
}

async function readHead(checkoutPath: string): Promise<string> {
  const head = await runGitCommand({ cwd: checkoutPath, args: ['rev-parse', 'HEAD'] });
  const commit = head.stdout.trim();
  if (!commit) {
    throw new SubagentBaseCheckoutError(`could not read HEAD of ${checkoutPath}`);
  }
  return commit;
}

/**
 * `baseBranch` wins; otherwise the parent session's recorded working
 * directory is used when it sits inside another linked worktree of the same
 * project. Returns `undefined` when the project root itself is the right base,
 * which keeps the previous behavior for every ordinary session.
 *
 * Throws {@link SubagentBaseCheckoutError} only for an explicit `baseBranch`
 * that cannot be honoured: silently falling back to the project root is how a
 * child ends up on a base the lead has already left.
 */
export async function resolveSubagentBaseCheckout(input: {
  projectPath: string;
  baseBranch?: string | undefined;
  workingDirectory?: string | undefined;
}): Promise<SubagentBaseCheckout | undefined> {
  const requestedBranch =
    input.baseBranch !== undefined && input.baseBranch.trim() !== ''
      ? normalizeBranchName(input.baseBranch)
      : undefined;
  const projectRoot = await canonicalPath(input.projectPath);

  const listed = await listGitWorktrees({ rootPath: input.projectPath, isRepository: true });
  const candidates: { entry: GitWorktreeEntry; path: string }[] = [];
  for (const entry of listed.worktrees) {
    if (!entry.reachable || isProductOwnedCheckout(entry)) continue;
    candidates.push({ entry, path: await canonicalPath(entry.worktreePath) });
  }

  if (requestedBranch !== undefined) {
    const match = candidates.find(({ entry }) => entry.branch === requestedBranch);
    if (!match) {
      throw new SubagentBaseCheckoutError(
        `baseBranch "${requestedBranch}" is not checked out in any worktree of this project. ` +
          'Check it out first (for example with `git worktree add`), or omit baseBranch to start ' +
          'from the project root.',
      );
    }
    if (match.path === projectRoot) return undefined;
    return {
      targetPath: match.entry.worktreePath,
      branch: match.entry.branch,
      baseCommit: await readHead(match.entry.worktreePath),
    };
  }

  const workingDirectory = input.workingDirectory?.trim();
  if (!workingDirectory) return undefined;
  const working = await canonicalPath(workingDirectory);
  // Longest match: a linked worktree nested under the project root (the
  // `.worktrees/` convention) must beat the root that contains it. Anything
  // that only lies inside the project root keeps the root as the base.
  const containing = candidates
    .filter(({ path }) => path !== projectRoot && isInside(path, working))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (!containing) return undefined;
  return {
    targetPath: containing.entry.worktreePath,
    branch: containing.entry.branch,
    baseCommit: await readHead(containing.entry.worktreePath),
  };
}

/**
 * Tip a child would start from right now: the resolved linked worktree, else
 * the project root. Lets a caller compare a retained lane against the lead's
 * current base without allocating anything.
 */
export async function resolveSubagentBaseCommit(input: {
  projectPath: string;
  baseBranch?: string | undefined;
  workingDirectory?: string | undefined;
}): Promise<string> {
  const checkout = await resolveSubagentBaseCheckout(input);
  return checkout?.baseCommit ?? (await readHead(input.projectPath));
}
