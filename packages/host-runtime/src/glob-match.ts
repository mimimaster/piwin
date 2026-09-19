/**
 * Shared glob matching for repo-relative POSIX paths.
 *
 * Extracted from `pi-package-inventory` so the package inventory matcher and
 * `code_search`'s include/exclude globs cannot drift apart. Patterns are
 * matched against `/`-separated relative paths; `*` never crosses a path
 * separator and `**` does.
 */

/** Whether a pattern carries glob meta (`*` or `?`). */
export function hasGlobMeta(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

/** Compile a glob pattern into an anchored regex over `/`-separated paths. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLESTAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLESTAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Match one repo-relative path against one glob pattern. */
export function globMatch(relativePath: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/^\.\//, '').replace(/\\/g, '/');
  const regex = globToRegExp(normalizedPattern);
  return regex.test(relativePath.replace(/\\/g, '/'));
}

/**
 * ripgrep-style pattern expansion: a bare name like `node_modules` also needs
 * to match nested occurrences, so `**​/node_modules` is searched alongside it.
 * A pattern that is already rooted (`**…`) or absolute (`/…`) is left alone.
 */
export function expandGlobVariants(pattern: string): string[] {
  if (typeof pattern !== 'string') {
    return [];
  }
  const normalized = pattern.trim().replace(/\\/g, '/');
  if (!normalized) {
    return [];
  }
  const expanded = [normalized];
  if (!normalized.startsWith('**') && !normalized.startsWith('/')) {
    expanded.push(`**/${normalized}`);
  }
  return [...new Set(expanded)];
}

/** Match a repo-relative path against any pattern, expanding each first. */
export function matchesAnyGlob(relativePath: string, patterns: readonly string[]): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return patterns.some((pattern) =>
    expandGlobVariants(pattern).some((variant) => globMatch(normalized, variant)),
  );
}
