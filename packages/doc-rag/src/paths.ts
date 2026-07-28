/**
 * Path helpers for doc-rag (folder-scoped indexing).
 *
 * Confinement rule (spec §7.1): every scanned / indexed / opened file path
 * must realpath to a location INSIDE the user-selected folder root. The
 * folder itself may be any absolute path — this is a deliberate, user-granted
 * escape from `~/.piwin/notes/`.
 */
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

/** Default piwin root: `~/.piwin`. */
export function getDefaultPiwinRoot(): string {
  return resolve(homedir(), '.piwin');
}

/** `~/.piwin/doc-rag`. */
export function getDocRagRoot(piwinRoot: string = getDefaultPiwinRoot()): string {
  return resolve(piwinRoot, 'doc-rag');
}

/**
 * Folder key for cache directory naming. Stable across reboots and short
 * enough for filesystem paths. Uses a 16-char sha256 prefix of the canonical
 * absolute path so two distinct folders never collide.
 */
export function folderKey(canonicalAbsPath: string): string {
  return sha256Hex(canonicalAbsPath).slice(0, 16);
}

/** `~/.piwin/doc-rag/<folder-key>/doc-index.sqlite3`. */
export function getDocIndexPath(canonicalAbsPath: string, piwinRoot?: string): string {
  return resolve(getDocRagRoot(piwinRoot), folderKey(canonicalAbsPath), 'doc-index.sqlite3');
}

/** `~/.piwin/doc-rag/<folder-key>/.source-path` sidecar (canonical path for cleanup/debug). */
export function getSourcePathSidecar(canonicalAbsPath: string, piwinRoot?: string): string {
  return resolve(getDocRagRoot(piwinRoot), folderKey(canonicalAbsPath), '.source-path');
}

/**
 * Canonicalize a folder path: resolve → realpath → strip trailing separators
 * (except root). Spec §7.2.
 *
 * Returns null when the path does not exist (caller surfaces "missing").
 */
export async function canonicalizeFolderPath(input: string): Promise<string | null> {
  const resolved = resolve(input);
  try {
    const { realpath } = await import('node:fs/promises');
    const real = await realpath(resolved);
    return stripTrailingSep(real);
  } catch {
    return null;
  }
}

/** Synchronous variant for tests that already hold a realpath. */
export function canonicalizeFolderPathSync(input: string): string {
  return stripTrailingSep(resolve(input));
}

function stripTrailingSep(path: string): string {
  if (path.length <= 1) return path;
  if (path.endsWith(sep)) return path.slice(0, -1);
  return path;
}

/**
 * Reject relative paths, `..` segments, absolute paths, and backslash
 * escapes. Used for `sourceFile` and `fileAllowlist` validation.
 */
export function isSafeRelativePath(relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath.length > 1024) return false;
  if (relativePath.startsWith('/')) return false;
  if (relativePath.startsWith('\\')) return false;
  // Reject any segment that is `..` (posix or win).
  const segments = relativePath.split(/[\\/]/);
  for (const segment of segments) {
    if (segment === '..') return false;
  }
  return true;
}

/**
 * Verify that `filePath` (relative to `folderRoot`) resolves under
 * `folderRoot` after realpath. Both sides are realpath-resolved so symlinked
 * tmp dirs (e.g. macOS `/var` → `/private/var`) compare correctly.
 * Spec §7.1 confinement.
 */
export async function isPathConfined(
  folderRoot: string,
  relativePath: string,
): Promise<boolean> {
  if (!isSafeRelativePath(relativePath)) return false;
  const absolute = resolve(folderRoot, relativePath);
  try {
    const { realpath } = await import('node:fs/promises');
    const realFile = await realpath(absolute);
    const realRoot = await realpath(folderRoot);
    if (realFile === realRoot) return false; // the folder itself is not a file
    return realFile.startsWith(realRoot + sep);
  } catch {
    return false;
  }
}

// Minimal sha256 — avoids pulling in node:crypto polyfill concerns for tests.
// We still use node:crypto at runtime (available in Node 20+).
import { createHash } from 'node:crypto';
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
