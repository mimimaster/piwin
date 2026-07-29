/**
 * Shared pure-string path-traversal helpers (ADR 0019 §4).
 *
 * No `realpath` / FS access here — symlink-aware canonicalization is the
 * caller's responsibility so these functions stay unit-testable without a
 * filesystem. Mirrors the `..` / `relativeToRoot` logic previously inlined in
 * `agent-host/commands/project-commands.ts`.
 */
import path from 'node:path';

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
