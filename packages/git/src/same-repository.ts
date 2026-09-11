/**
 * Same-repo detection via `--git-common-dir`. Worktrees may live on another
 * volume; path prefixes are not a reliable grouping key.
 */
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { probeGitRepository } from './repository-probe.js';

function normalizePath(projectPath: string): string {
  return resolve(projectPath).replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * True when `projectPath` is the git checkout itself (or a symlink to it),
 * not a directory inside that checkout.
 */
async function isGitCheckoutAlias(projectPath: string, checkoutRoot: string): Promise<boolean> {
  const normalized = normalizePath(projectPath);
  const root = normalizePath(checkoutRoot);
  if (normalized === root) {
    return true;
  }
  if (normalized.startsWith(`${root}/`)) {
    return false;
  }
  try {
    return normalizePath(await realpath(projectPath)) === root;
  } catch {
    return false;
  }
}

export async function resolveGitCommonDir(projectPath: string): Promise<string | null> {
  const identity = await probeGitRepository(projectPath);
  return identity.commonDir ?? null;
}

/**
 * Return the first trusted project path that shares a git common dir with
 * `candidatePath`. Used so a newly opened worktree inherits trust.
 */
export async function findTrustedSameRepositoryRoot(
  candidatePath: string,
  trustedProjectPaths: readonly string[],
): Promise<string | null> {
  const candidateCommonDir = await resolveGitCommonDir(candidatePath);
  if (!candidateCommonDir) {
    return null;
  }
  for (const trustedPath of trustedProjectPaths) {
    if (trustedPath === candidatePath) {
      continue;
    }
    const trustedCommonDir = await resolveGitCommonDir(trustedPath);
    if (trustedCommonDir === candidateCommonDir) {
      return trustedPath;
    }
  }
  return null;
}

/**
 * Return a registered project that is the same git checkout as `candidatePath`
 * (same `--show-toplevel`). Skips remembered subdirectories of that checkout.
 * A linked worktree (different toplevel) does not match.
 */
export async function findRegisteredGitWorktreeRoot(
  candidatePath: string,
  registeredProjectPaths: readonly string[],
): Promise<string | null> {
  const candidate = await probeGitRepository(candidatePath);
  if (!candidate.isRepository || !candidate.rootPath) {
    return null;
  }
  const candidateRoot = candidate.rootPath;
  for (const registeredPath of registeredProjectPaths) {
    const registered = await probeGitRepository(registeredPath);
    if (!registered.isRepository || !registered.rootPath) {
      continue;
    }
    if (registered.rootPath !== candidateRoot) {
      continue;
    }
    if (await isGitCheckoutAlias(registeredPath, registered.rootPath)) {
      return registeredPath;
    }
  }
  return null;
}

/**
 * Path to persist for `project/open`.
 * Reuses a registered checkout alias (including a symlink to the git root).
 * A subdirectory of an unregistered checkout is lifted to `--show-toplevel`.
 */
export async function resolveOpenGitWorkspacePath(
  candidatePath: string,
  registeredProjectPaths: readonly string[],
): Promise<string> {
  const alias = await findRegisteredGitWorktreeRoot(candidatePath, registeredProjectPaths);
  if (alias) {
    return alias;
  }
  const candidate = await probeGitRepository(candidatePath);
  if (!candidate.isRepository || !candidate.rootPath) {
    return resolve(candidatePath);
  }
  if (await isGitCheckoutAlias(candidatePath, candidate.rootPath)) {
    return resolve(candidatePath);
  }
  return candidate.rootPath;
}
