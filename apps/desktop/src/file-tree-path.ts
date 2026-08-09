/** Resolve a project-relative file-tree path using the host platform separator. */
export function resolveProjectEntryAbsolutePath(projectPath: string, relativePath: string): string {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  const normalizedProjectPath = projectPath.replace(/[\\/]+$/, '');
  const normalizedRelativePath = relativePath
    .replace(/^[\\/]+/, '')
    .replace(/[\\/]+/g, separator);

  if (normalizedRelativePath.length === 0) {
    return normalizedProjectPath || separator;
  }
  if (normalizedProjectPath.length === 0) {
    return `${separator}${normalizedRelativePath}`;
  }
  return `${normalizedProjectPath}${separator}${normalizedRelativePath}`;
}
