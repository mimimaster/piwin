/**
 * Managed process cwd policy: absolute path must resolve under a trusted project root.
 */
import { resolve, sep } from 'node:path';

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
  for (const root of trustedProjectRoots) {
    if (isPathInsideRoot(absoluteCwd, root)) {
      return { ok: true, absoluteCwd, projectRoot: resolve(root) };
    }
  }
  return {
    ok: false,
    reason: `cwd is outside trusted projects: ${absoluteCwd}`,
  };
}
