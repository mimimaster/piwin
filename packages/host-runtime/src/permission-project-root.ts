import path from 'node:path';

/**
 * Permission leave-workspace root. Empty means No Repo / General: YOLO must
 * not apply the project-escape gate (the machine is the trust boundary).
 */
export function resolvePermissionProjectRoot(
  projectPath: string | undefined,
  generalWorkspacePath: string,
): string {
  const trimmed = projectPath?.trim() ?? '';
  if (trimmed.length === 0) {
    return '';
  }
  if (path.resolve(trimmed) === path.resolve(generalWorkspacePath)) {
    return '';
  }
  return trimmed;
}

export function isBoundPermissionProjectRoot(projectRoot: string): boolean {
  return projectRoot.trim().length > 0;
}
