/** Project trust + workspace records under ~/.piwin */

export type ProjectTrustLevel = 'untrusted' | 'trusted';

/** Project-scoped network allowlist (remembered after explicit user allow). */
export type ProjectNetworkPolicy = {
  /** Hostnames allowed for web_fetch without re-prompt (lowercase). */
  allowedFetchHosts: string[];
  /** When true, web_search does not re-prompt for this project. */
  allowWebSearch: boolean;
};

export type ProjectRecord = {
  path: string;
  trust: ProjectTrustLevel;
  displayName?: string;
  lastOpenedAt: string;
  createdAt: string;
  networkPolicy?: ProjectNetworkPolicy;
  /** Project-scoped bash command patterns allowed without prompting (ADR 0019). */
  bashAllowlist?: string[];
  /** Project-scoped file write paths allowed without prompting (ADR 0019). */
  fileWriteAllowlist?: string[];
};

export type ProjectStoreDocument = {
  version: 1;
  projects: ProjectRecord[];
};

/** Response for `project/list`; ordered by most recently opened first. */
export type ProjectListData = {
  projects: ProjectRecord[];
};

export function createEmptyNetworkPolicy(): ProjectNetworkPolicy {
  return {
    allowedFetchHosts: [],
    allowWebSearch: false,
  };
}

/**
 * Flattened view of project-remembered tool permissions for Settings UI.
 * `key` is stable for revoke (e.g. network:web_search, network:fetch:example.com).
 */
export type RememberedPermission = {
  key: string;
  action: string;
  detail: string;
  createdAt?: string;
};

export type ProjectPermissionsListData = {
  projectPath: string;
  permissions: RememberedPermission[];
};

export type ProjectPermissionsRevokeData = {
  projectPath: string;
  key: string;
  ok: true;
};

/** Single directory entry for the workspace file tree. */
export type ProjectDirEntry = {
  name: string;
  /** Relative path from project root (posix-style, no leading slash). */
  relativePath: string;
  kind: 'file' | 'directory';
  /** Bytes when known for files; omitted for directories. */
  sizeBytes?: number;
};

/** Response for `project/list-dir`. */
export type ProjectListDirData = {
  projectPath: string;
  /** Relative directory listed (empty string = root). */
  relativePath: string;
  entries: ProjectDirEntry[];
};

/** Response for `project/read-file` (text preview; images may include a data URL). */
export type ProjectReadFileData = {
  projectPath: string;
  relativePath: string;
  /** Absolute path under project root. */
  absolutePath: string;
  /** UTF-8 text (may be truncated). Empty when `isBinary` and no text decode. */
  content: string;
  byteSize: number;
  truncated: boolean;
  /** When true, host refused to decode as text (binary/too large). */
  isBinary: boolean;
  mimeHint?: string;
  /**
   * Inline media preview for image files under the project root.
   * Set when the host can safely base64-encode the bytes for the Desktop
   * file-tree viewer (asset protocol cannot scope arbitrary project paths).
   */
  previewDataUrl?: string;
};
