/**
 * Host machine OS facts. Shells must follow these, never process.platform
 * of the client, when talking about Host filesystem paths.
 */
export type HostOsFamily = 'darwin' | 'linux' | 'win32' | 'other';

export type HostPathStyle = 'posix' | 'windows';

export function hostOsFamilyFromNodePlatform(platform: string): HostOsFamily {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
    return platform;
  }
  return 'other';
}

export function hostPathStyleFromOsFamily(family: HostOsFamily): HostPathStyle {
  return family === 'win32' ? 'windows' : 'posix';
}

/** Placeholder shown when a remote shell asks for a Host workspace path. */
export function hostWorkspacePathExample(family: HostOsFamily): string {
  switch (family) {
    case 'win32':
      return 'C:\\Users\\you\\project';
    case 'darwin':
      return '/Users/you/project';
    default:
      return '/home/you/project';
  }
}

export function looksLikeHostAbsolutePath(value: string, style: HostPathStyle): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (style === 'windows') {
    return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\');
  }
  return trimmed.startsWith('/');
}

/** One directory (or file) on the Host, for the shell folder picker. */
export type HostDirEntry = {
  name: string;
  kind: 'directory' | 'file';
  /** Absolute Host path. */
  path: string;
};

/** Response for `host/list-dir`. */
export type HostListDirData = {
  path: string;
  parentPath: string | null;
  homePath: string;
  entries: HostDirEntry[];
};
