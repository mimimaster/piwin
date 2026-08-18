import { createHash } from 'node:crypto';

/**
 * Stable Host-issued project id from a registered project path.
 * Format is fixed: `project-` + first 24 hex chars of sha256(path).
 * Must stay byte-compatible with historical remote projection ids.
 */
export function projectIdForPath(projectPath: string): string {
  return `project-${createHash('sha256').update(projectPath).digest('hex').slice(0, 24)}`;
}

/**
 * Resolve a Host-issued projectId to a registered project path.
 * Returns undefined when no registered path produces the id.
 */
export function resolveProjectPathById(
  projects: readonly { path: string }[],
  projectId: string,
): string | undefined {
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return undefined;
  }
  for (const project of projects) {
    if (projectIdForPath(project.path) === projectId) {
      return project.path;
    }
  }
  return undefined;
}
