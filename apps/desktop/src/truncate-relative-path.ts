/**
 * Path display and truncation utilities for git changes and workspace files.
 */

export type DisplayPathParts = {
  fileName: string;
  dirPath: string;
  fullDisplayPath: string;
};

/**
 * Normalizes backslashes to forward slashes and strips the project root prefix
 * when the path is inside projectPath.
 */
export function getRelativeFilePath(fullPath: string, projectPath?: string | null): string {
  if (!fullPath) return '';
  const normPath = fullPath.replace(/\\/g, '/');
  if (!projectPath) {
    return normPath;
  }
  const normProj = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normPath === normProj) {
    return '.';
  }
  if (normPath.startsWith(normProj + '/')) {
    return normPath.slice(normProj.length + 1);
  }
  return normPath;
}

/**
 * Splits a path (either absolute or relative) into directory and filename parts
 * relative to the projectPath.
 */
export function formatDisplayPathParts(
  fullPath: string,
  projectPath?: string | null,
): DisplayPathParts {
  const relPath = getRelativeFilePath(fullPath, projectPath);
  const parts = relPath.split('/');
  const fileName = parts[parts.length - 1] || relPath;
  const dirPath = parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
  return {
    fileName,
    dirPath,
    fullDisplayPath: relPath,
  };
}

export type ChangeStatusInfo = {
  label: string;
  tone: 'success' | 'danger' | 'warning' | 'neutral';
  shortCode: string;
};

export function resolveChangeStatusInfo(
  status: string,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): ChangeStatusInfo {
  const isZh = locale === 'zh-CN';
  switch (status) {
    case 'added':
    case 'untracked':
      return {
        label: isZh ? '新增' : 'New',
        tone: 'success',
        shortCode: status === 'untracked' ? 'U' : 'A',
      };
    case 'deleted':
      return {
        label: isZh ? '删除' : 'Deleted',
        tone: 'danger',
        shortCode: 'D',
      };
    case 'modified':
      return {
        label: isZh ? '修改' : 'Modified',
        tone: 'warning',
        shortCode: 'M',
      };
    case 'renamed':
      return {
        label: isZh ? '重命名' : 'Renamed',
        tone: 'neutral',
        shortCode: 'R',
      };
    case 'conflicted':
      return {
        label: isZh ? '冲突' : 'Conflicted',
        tone: 'danger',
        shortCode: 'C',
      };
    default:
      return {
        label: status || (isZh ? '变更' : 'Changed'),
        tone: 'neutral',
        shortCode: status.slice(0, 1).toUpperCase() || '?',
      };
  }
}
