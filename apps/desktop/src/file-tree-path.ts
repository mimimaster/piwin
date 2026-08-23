import type { HostPathStyle } from '@piwin/contracts';

/** Resolve a project-relative file-tree path using the Host path style. */
export function resolveProjectEntryAbsolutePath(
  projectPath: string,
  relativePath: string,
  pathStyle?: HostPathStyle,
): string {
  const separator =
    pathStyle === 'windows' ? '\\' : pathStyle === 'posix' ? '/' : projectPath.includes('\\') ? '\\' : '/';
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
