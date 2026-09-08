/**
 * Workspace identity for the in-process write gate.
 * Overlap is ancestor/descendant by directory boundary, not string prefix.
 */
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function normalizeWorkspaceRoot(rootPath: string): string {
  const resolved = resolve(rootPath);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function workspaceRootsOverlap(leftRoot: string, rightRoot: string): boolean {
  if (leftRoot === rightRoot) {
    return true;
  }
  return isPathInside(leftRoot, rightRoot) || isPathInside(rightRoot, leftRoot);
}

function isPathInside(parentRoot: string, childRoot: string): boolean {
  const rel = relative(parentRoot, childRoot);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
