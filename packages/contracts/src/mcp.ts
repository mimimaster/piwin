/** MCP config — Cursor/Claude compatible shape */

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  /**
   * When true, lifecycle manager restarts the server **once** after an unexpected crash.
   * Default false (safe); never loops forever.
   */
  restartOnCrash?: boolean;
};

export type McpConfigDocument = {
  mcpServers: Record<string, McpServerConfig>;
};

export type McpToolSummary = {
  serverId: string;
  name: string;
  /** Prefixed tool name exposed to the agent: mcp__<server>__<tool> */
  exposedName: string;
  description: string;
  /** Optional JSON Schema from tools/list when available. */
  inputSchema?: Record<string, unknown>;
};

/** Stable tool selector: `${serverId}.${toolName}`. */
export type McpToolSelector = string;

/** How a tool is exposed into a Pi session. */
export type McpExposure = 'direct' | 'gateway';

/**
 * Cached MCP tool metadata used to build direct tools without a live transport.
 * Fingerprint is a digest of the server definition; raw environment values
 * are never persisted in this metadata document.
 */
export type McpToolMetadata = {
  serverId: string;
  toolName: string;
  selector: McpToolSelector;
  description: string;
  inputSchema: Record<string, unknown>;
  metadataFingerprint: string;
  fetchedAt: string;
};

/** Persisted product document for MCP tool metadata cache. */
export type McpMetadataDocument = {
  version: 1;
  /** serverId -> tools for that server's current fingerprint. */
  servers: Record<
    string,
    {
      metadataFingerprint: string;
      tools: McpToolMetadata[];
      updatedAt: string;
      stale?: boolean;
    }
  >;
};

/** Direct-tool exposure budget for hybrid mode. */
export type McpExposurePolicy = {
  mode: 'hybrid';
  maxDirectTools: number;
  maxDirectSchemaBytes: number;
  pinnedSelectors: string[];
};

export function createDefaultMcpExposurePolicy(): McpExposurePolicy {
  return {
    mode: 'hybrid',
    maxDirectTools: 48,
    maxDirectSchemaBytes: 48_000,
    pinnedSelectors: [],
  };
}

/** Host-owned MCP process lifecycle status. */
export type McpServerRuntimeStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error'
  | 'disabled';

export type McpServerHealth = {
  serverId: string;
  status: McpServerRuntimeStatus;
  command: string;
  disabled: boolean;
  toolCount: number;
  lastError?: string;
  startedAt?: string;
  pid?: number;
};

export type InstallSource =
  | { kind: 'local'; path: string }
  | { kind: 'git'; url: string; ref?: string; subdir?: string };
