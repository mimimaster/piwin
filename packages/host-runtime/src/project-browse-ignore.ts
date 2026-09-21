/**
 * Directories the file browser and the project file search both skip.
 *
 * One list on purpose: the search must not resolve a click into a folder the
 * tree refuses to show (vendored code, build output, VCS metadata).
 */
export const IGNORED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.pnpm-store',
  'dist',
  'target',
  '.next',
  'coverage',
]);
