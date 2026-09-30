/**
 * Path variants offered by the document header menu. Pure: the Host root and the
 * clipboard stay with the caller.
 */
import { resolveProjectFilesystemRoot } from './remote-session-hydrate.js';

export function isAbsoluteDiskPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

/** Path relative to the project root, or null when the file lives outside it. */
export function documentRelativePath(
  absolutePath: string,
  projectPath: string | undefined,
): string | null {
  const root = resolveProjectFilesystemRoot(projectPath);
  if (!root || !isAbsoluteDiskPath(absolutePath)) return null;
  const normalized = absolutePath.replace(/\\/g, '/');
  const normalizedRoot = root.replace(/\\/g, '/');
  if (!normalized.startsWith(`${normalizedRoot}/`)) return null;
  const relative = normalized.slice(normalizedRoot.length + 1);
  return relative || null;
}
