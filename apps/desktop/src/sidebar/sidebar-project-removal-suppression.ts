/** Local suppression while sidebar removals are pending or Host-confirmed. */
import { normalizeSidebarProjectPath } from './sidebar-repo-groups';

export const normalizeSidebarRemovalPath = normalizeSidebarProjectPath;

export function suppressedSidebarPaths(
  pending: ReadonlySet<string>,
  hidden: ReadonlySet<string>,
): Set<string> {
  return new Set([...pending, ...hidden]);
}

export function isSuppressedSidebarPath(
  suppressed: ReadonlySet<string>,
  projectPath: string,
): boolean {
  return pathSetHas(suppressed, projectPath);
}

/** Only a fresh registered list may clear committed hides; never pending removals. */
export function clearHiddenSidebarPath(hidden: Set<string>, projectPath: string): void {
  const normalized = normalizeSidebarRemovalPath(projectPath);
  for (const entry of [...hidden]) {
    if (normalizeSidebarRemovalPath(entry) === normalized) hidden.delete(entry);
  }
}

export function markPendingSidebarRemoval(pending: Set<string>, projectPath: string): void {
  pending.add(normalizeSidebarRemovalPath(projectPath));
}

export function releasePendingSidebarRemoval(pending: Set<string>, projectPath: string): void {
  clearHiddenSidebarPath(pending, projectPath);
}

export function rememberHiddenSidebarPath(hidden: Set<string>, projectPath: string): void {
  hidden.add(normalizeSidebarRemovalPath(projectPath));
}

export function applyRegisteredProjectsToHiddenSuppressions(
  hidden: Set<string>,
  registeredPaths: readonly string[],
): void {
  for (const path of registeredPaths) clearHiddenSidebarPath(hidden, path);
}

export function filterPathsAgainstSuppression<T extends { path: string }>(
  items: readonly T[],
  suppressed: ReadonlySet<string>,
): T[] {
  return items.filter((item) => !isSuppressedSidebarPath(suppressed, item.path));
}

export function pathSetHas(paths: ReadonlySet<string>, projectPath: string): boolean {
  if (paths.has(projectPath)) return true;
  const normalized = normalizeSidebarRemovalPath(projectPath);
  for (const entry of paths) {
    if (normalizeSidebarRemovalPath(entry) === normalized) return true;
  }
  return false;
}
