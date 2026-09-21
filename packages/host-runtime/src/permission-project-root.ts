/**
 * Permission leave-workspace root.
 *
 * Empty means General conversation (no project binding): YOLO must not apply
 * the project-escape gate. No Repo agent sessions bind the workspace path as
 * a real project root, same as a folder session.
 */
export function resolvePermissionProjectRoot(
  projectPath: string | undefined,
  _generalWorkspacePath: string,
): string {
  return projectPath?.trim() ?? '';
}

export function isBoundPermissionProjectRoot(projectRoot: string): boolean {
  return projectRoot.trim().length > 0;
}
