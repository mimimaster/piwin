/**
 * Repository-relative subdirectory rule shared by every git-sourced installer
 * (skills, extensions, plugins). Pure string logic so one audited rule backs
 * all of them: a subdir may only name a folder inside the cloned repository.
 */

export class RepositorySubdirError extends Error {
  override readonly name = 'RepositorySubdirError';
  constructor(readonly subdir: string) {
    super('git source subdir must remain inside the cloned repository');
  }
}

/**
 * Normalize an optional subdir to `a/b` form (`''` = repository root).
 * Rejects absolute paths, drive letters, NUL and any `..` segment rather than
 * resolving them, so no input can name a location outside the clone.
 */
export function normalizeRepositorySubdir(subdir: string | undefined): string {
  if (subdir === undefined) return '';
  if (
    subdir.includes('\0') ||
    /^[\\/]/.test(subdir) ||
    /^[A-Za-z]:/.test(subdir)
  ) {
    throw new RepositorySubdirError(subdir);
  }
  const segments = subdir.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) {
    throw new RepositorySubdirError(subdir);
  }
  return segments.join('/');
}
