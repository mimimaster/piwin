/** Last path segment for workspace labels. */
export function projectDisplayName(projectPath: string | null): string {
  if (!projectPath) {
    return 'No project';
  }
  const parts = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

/**
 * Visible project name. Remote shells keep an opaque `project-<hex>` key in
 * `path`; the Host list still carries `displayName` (folder basename).
 */
export function projectLabel(
  projectPath: string | null,
  projects: readonly { path: string; displayName?: string }[] = [],
): string {
  if (!projectPath) {
    return projectDisplayName(null);
  }
  const named = projects
    .find((project) => project.path === projectPath)
    ?.displayName?.trim();
  if (named) {
    return named;
  }
  return projectDisplayName(projectPath);
}
