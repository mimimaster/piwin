/**
 * Shared pure-string path-traversal helpers (ADR 0019 §4).
 *
 * No `realpath` / FS access here — symlink-aware canonicalization is the
 * caller's responsibility so these functions stay unit-testable without a
 * filesystem. Mirrors the `..` / `relativeToRoot` logic previously inlined in
 * `agent-host/commands/project-commands.ts`.
 */
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';

/**
 * Does `candidateAbs` escape `rootAbs`? Both sides are resolved (normalized)
 * before comparing via `path.relative`. A candidate that resolves to the root
 * or beneath it returns `false`; anything whose relative path starts with `..`
 * or is absolute (different drive/anchor) returns `true`.
 *
 * This is a boundary check, not a naive prefix match: `/home/u/project-evil`
 * is correctly reported as escaping `/home/u/project`.
 */
export function escapesRoot(rootAbs: string, candidateAbs: string): boolean {
  const root = path.resolve(rootAbs);
  const candidate = path.resolve(candidateAbs);
  const relativeToRoot = path.relative(root, candidate);
  return relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot);
}

/**
 * Resolve a project-relative input to an absolute path guaranteed to stay
 * inside `rootAbs`. Pure-string: no realpath / FS.
 *
 * Normalization mirrors `project-commands.ts`: backslashes become forward
 * slashes, leading/trailing slashes are stripped, and any literal `..` token
 * is rejected up front. The result is then verified with {@link escapesRoot}
 * as a defense-in-depth check.
 *
 * Returns `{ ok: true, absolute }` on success, or `{ ok: false, reason }`
 * with a stable reason string suitable for host command error messages.
 */
export function resolveInsideRoot(
  rootAbs: string,
  relativeInput: string,
): { ok: true; absolute: string } | { ok: false; reason: string } {
  const root = path.resolve(rootAbs);
  const relativeNormalized = relativeInput
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (relativeNormalized.includes('..')) {
    return { ok: false, reason: 'relativePath must not contain ..' };
  }
  const absolute = relativeNormalized
    ? path.resolve(root, relativeNormalized)
    : root;
  if (escapesRoot(root, absolute)) {
    return { ok: false, reason: 'path escapes project root' };
  }
  return { ok: true, absolute };
}

/**
 * Stable reasons for project-path authority checks used by Host commands.
 * Keep strings stable — Desktop and tests match on these.
 */
export type ProjectPathAuthorityReason =
  | 'project-root-required'
  | 'project-root-not-registered'
  | 'relativePath must not contain ..'
  | 'path escapes project root'
  | 'path escapes project root via symlink'
  | 'project root does not exist'
  | 'path does not exist';

export type ResolveProjectPathResult =
  | {
      ok: true;
      /** Lexical absolute path under the registered root. */
      absolute: string;
      /** realpath of the registered project root. */
      rootReal: string;
      /**
       * realpath of the target when it exists. Missing targets keep
       * `absolute` only (caller decides whether absence is an error).
       */
      realAbsolute?: string;
    }
  | { ok: false; reason: ProjectPathAuthorityReason | string };

/**
 * Normalize a caller-supplied project root for store lookup / comparison.
 * Does not touch the filesystem.
 */
export function normalizeProjectRootPath(projectPath: string): string {
  return path.resolve(projectPath.trim());
}

/**
 * True when `projectPath` matches a remembered project record by resolved path.
 * Comparison is lexical resolve only (no realpath) so missing disks still match
 * the store entry used at open time.
 */
export function isRegisteredProjectRoot(
  registeredRoots: readonly string[],
  projectPath: string,
): boolean {
  const normalized = normalizeProjectRootPath(projectPath);
  if (!normalized) {
    return false;
  }
  return registeredRoots.some((root) => normalizeProjectRootPath(root) === normalized);
}

async function realpathIfExists(targetPath: string): Promise<string | null> {
  try {
    return await realpath(targetPath);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve a relative path under a project root with realpath containment.
 *
 * Steps:
 * 1. Lexical {@link resolveInsideRoot} (rejects `..` and drive escapes).
 * 2. realpath the root (must exist).
 * 3. If the target exists, realpath it and require it stays inside rootReal.
 *
 * Symlinks *inside* the project that stay inside the root are allowed.
 * Symlinks that realpath outside the root are rejected.
 */
export async function resolveInsideRootWithRealpath(
  rootAbs: string,
  relativeInput: string,
): Promise<ResolveProjectPathResult> {
  const lexical = resolveInsideRoot(rootAbs, relativeInput);
  if (!lexical.ok) {
    return lexical;
  }

  let rootReal: string;
  try {
    rootReal = await realpath(path.resolve(rootAbs));
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return { ok: false, reason: 'project root does not exist' };
    }
    throw error;
  }

  // Re-anchor under the real root so a symlinked project root still contains
  // its own files after realpath (lexical path may still use the link prefix).
  const underRealRoot = resolveInsideRoot(rootReal, relativeInput);
  if (!underRealRoot.ok) {
    return underRealRoot;
  }

  const targetReal = await realpathIfExists(underRealRoot.absolute);
  if (targetReal === null) {
    return { ok: true, absolute: underRealRoot.absolute, rootReal };
  }

  if (escapesRoot(rootReal, targetReal)) {
    return { ok: false, reason: 'path escapes project root via symlink' };
  }

  // Optional: confirm it is still a path we can reason about.
  try {
    await stat(targetReal);
  } catch {
    return { ok: false, reason: 'path does not exist' };
  }

  return {
    ok: true,
    absolute: underRealRoot.absolute,
    rootReal,
    realAbsolute: targetReal,
  };
}
