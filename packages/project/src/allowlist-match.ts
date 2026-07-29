/**
 * Safe allowlist matchers for remembered project permissions (ADR 0019 §6).
 *
 * These matchers are deliberately **not** naive string-prefix:
 * - Bash: exact command match only. Approving `rm -rf /tmp/foo` must not
 *   auto-allow `rm -rf /tmp/foo /etc` or `rm -rf /tmp/foobar`. Broader reuse
 *   goes through `permissions.json` globs.
 * - File-write: path-safe prefix with a separator boundary. `/home/u/dir`
 *   matches `/home/u/dir` and `/home/u/dir/file` but NOT `/home/u/directory`.
 *
 * Pure string — no `realpath` / FS. Callers resolve symlinks before invoking.
 */
import path from 'node:path';

/**
 * Exact-match bash command allowlist (after trim). Returns `true` only when
 * the command equals a stored entry verbatim.
 */
export function commandInBashAllowlist(
  command: string,
  allowlist: readonly string[],
): boolean {
  const normalized = command.trim();
  if (!normalized) {
    return false;
  }
  return allowlist.some((entry) => entry.trim() === normalized);
}

/**
 * Path-safe prefix file-write allowlist. Both sides are normalized
 * (`.` / `..` collapsed, trailing separators stripped) before comparison.
 * A target matches when it equals a stored entry or is a descendant of it
 * with a real separator boundary — never `/home/u/a` matching `/home/u/ab`.
 */
export function pathInFileWriteAllowlist(
  absPath: string,
  allowlist: readonly string[],
): boolean {
  const target = normalizePathForMatch(absPath);
  if (!target) {
    return false;
  }
  const sep = path.sep;
  return allowlist.some((entry) => {
    const stored = normalizePathForMatch(entry);
    if (!stored) {
      return false;
    }
    if (target === stored) {
      return true;
    }
    return target.startsWith(stored + sep);
  });
}

/**
 * Normalize an absolute path for safe prefix matching: collapse `.` / `..`
 * segments and strip a trailing separator (except for the root). Returns `''`
 * for empty/whitespace input.
 */
function normalizePathForMatch(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  const normalized = path.normalize(trimmed);
  if (normalized.length > 1 && normalized.endsWith(path.sep)) {
    return normalized.slice(0, -1);
  }
  return normalized;
}
