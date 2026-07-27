/** Last path segment for workspace labels. */
export function projectDisplayName(projectPath: string | null): string {
  if (!projectPath) {
    return 'No project';
  }
  const parts = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}
