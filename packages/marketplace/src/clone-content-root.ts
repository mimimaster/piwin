import { resolve, sep } from 'node:path';

/** Resolve an optional git subdirectory without allowing clone-root escape. */
export function resolveCloneContentRoot(clonePath: string, subdir?: string): string {
  const absoluteClonePath = resolve(clonePath);
  const absoluteContentPath = resolve(absoluteClonePath, subdir ?? '.');
  const clonePathPrefix = absoluteClonePath.endsWith(sep)
    ? absoluteClonePath
    : `${absoluteClonePath}${sep}`;
  if (
    absoluteContentPath !== absoluteClonePath &&
    !absoluteContentPath.startsWith(clonePathPrefix)
  ) {
    throw new Error('git source subdir must remain inside the cloned repository');
  }
  return absoluteContentPath;
}
