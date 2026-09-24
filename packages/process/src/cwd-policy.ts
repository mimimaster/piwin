/**
 * Managed process cwd policy: absolute path must resolve under a trusted project root.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

/**
 * The real location behind a path. Trust is about the directory, not the
 * spelling: a project registered through a symlink (`/Volumes/…/piwin` →
 * `~/Developer/piwin`) must still cover a path spelled through the target, and
 * a symlink inside a project that points elsewhere is elsewhere. A path that
 * does not exist yet (a file about to be written) is resolved through its
 * nearest existing ancestor, then the missing tail is re-attached.
 */
export function canonicalFsPath(path: string): string {
  const absolute = resolve(path);
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      missing.push(basename(current));
      current = parent;
    }
  }
}

export type CwdPolicyResult =
  | { ok: true; absoluteCwd: string; projectRoot: string }
  | { ok: false; reason: string };

/**
 * True when `candidatePath` is exactly `root` or a path under `root`.
 * Uses resolved absolute paths; rejects path-escape via `..`.
 */
export function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const absoluteCandidate = resolve(candidatePath);
  const absoluteRoot = resolve(rootPath);
  if (absoluteCandidate === absoluteRoot) {
    return true;
  }
  const rootWithSeparator = absoluteRoot.endsWith(sep)
    ? absoluteRoot
    : `${absoluteRoot}${sep}`;
  return absoluteCandidate.startsWith(rootWithSeparator);
}

/**
 * Validate cwd against a list of trusted project roots.
 * First matching root wins (used for projectPath on the record).
 */
export function resolveTrustedCwd(
  cwd: string,
  trustedProjectRoots: readonly string[],
): CwdPolicyResult {
  if (!cwd || typeof cwd !== 'string' || !cwd.trim()) {
    return { ok: false, reason: 'cwd is required' };
  }
  if (trustedProjectRoots.length === 0) {
    return { ok: false, reason: 'no trusted project roots' };
  }
  const absoluteCwd = resolve(cwd);
  const canonicalCwd = canonicalFsPath(absoluteCwd);
  for (const root of trustedProjectRoots) {
    if (isPathInsideRoot(canonicalCwd, canonicalFsPath(root))) {
      return { ok: true, absoluteCwd, projectRoot: resolve(root) };
    }
  }
  return {
    ok: false,
    reason: `cwd is outside trusted projects: ${absoluteCwd}`,
  };
}
