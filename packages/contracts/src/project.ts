/** Project trust + workspace records under ~/.piwin */

export type ProjectTrustLevel = 'untrusted' | 'trusted';

/** Project-scoped network allowlist (remembered after explicit user allow). */
export type ProjectNetworkPolicy = {
  /** Hostnames allowed for web_fetch without re-prompt (lowercase). */
  allowedFetchHosts: string[];
  /** When true, web_search does not re-prompt for this project. */
  allowWebSearch: boolean;
};

/**
 * Project-scoped MCP allowlist (remembered after explicit user allow).
 *
 * `allowedServerIds` is **server-level**: once a server id is listed, both
 * `mcp:connect` and `mcp:tool-call` for that server skip re-prompt for the project.
 * Per-tool fine grain is intentionally not modeled here (see residual D-MCP-02d-tool-fine).
 */
export type ProjectMcpPolicy = {
  /** MCP server ids allowed for connect + all tool calls without re-prompt. */
  allowedServerIds: string[];
};

export type ProjectRecord = {
  path: string;
  trust: ProjectTrustLevel;
  displayName?: string;
  lastOpenedAt: string;
  createdAt: string;
  networkPolicy?: ProjectNetworkPolicy;
  mcpPolicy?: ProjectMcpPolicy;
};

export type ProjectStoreDocument = {
  version: 1;
  projects: ProjectRecord[];
};

export function createEmptyNetworkPolicy(): ProjectNetworkPolicy {
  return {
    allowedFetchHosts: [],
    allowWebSearch: false,
  };
}

export function createEmptyMcpPolicy(): ProjectMcpPolicy {
  return {
    allowedServerIds: [],
  };
}
