/**
 * Scan / index limits (spec §7.3). Defaults are conservative; all can be
 * overridden by callers with explicit reasons.
 */
export const DEFAULT_MAX_FILES = 2_000;
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024; // 512 KiB
export const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024; // 32 MiB
export const DEFAULT_MAX_WALK_DEPTH = 12;

export const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.svn',
  '__pycache__',
]);

export const SKIP_FILE_NAME_PATTERNS: ReadonlyArray<RegExp> = [
  /^\.env(\..*)?$/,
  /.*\.pem$/,
  /.*\.key$/,
  /^id_rsa.*/,
  /^credentials\.json$/,
];

/** Default retrieval limits (spec §18). */
export const DEFAULT_RETRIEVE_LIMIT = 10;
export const DEFAULT_MAX_TOTAL_CHARS = 24_000;

/** Max cards per `flashcard_batch_create` (spec §7.4, §15). */
export const DEFAULT_MAX_BATCH_SIZE = 40;

/** Chunker fallback size for code files without parseable boundaries. */
export const CODE_FALLBACK_MAX_LINES = 200;
