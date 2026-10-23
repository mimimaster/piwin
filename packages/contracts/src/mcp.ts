/** MCP config — Cursor/Claude compatible shape */

type McpServerCommonConfig = {
  disabled?: boolean;
  /**
   * When true, lifecycle manager restarts the server **once** after an unexpected crash
   * (stdio) or a dropped connection (remote). Default false (safe); never loops forever.
   */
  restartOnCrash?: boolean;
};

/** A local server the Host spawns and talks to over stdin/stdout. */
export type McpStdioServerConfig = McpServerCommonConfig & {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  url?: never;
};

/**
 * A server the Host reaches over HTTP. `http` is Streamable HTTP, `sse` the
 * legacy HTTP+SSE transport; without `type` the Host tries Streamable HTTP and
 * falls back to SSE. Header values expand `${VAR}` from the Host environment,
 * so tokens can stay out of mcp.json.
 */
export type McpRemoteServerConfig = McpServerCommonConfig & {
  type?: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  command?: never;
};

export type McpServerConfig = McpStdioServerConfig | McpRemoteServerConfig;

export type McpServerTransportKind = 'stdio' | 'http' | 'sse';

export function isRemoteMcpServerConfig(
  config: McpServerConfig,
): config is McpRemoteServerConfig {
  return typeof config.url === 'string';
}

/** Transport the config asks for; `http` also covers the untyped auto mode. */
export function mcpServerTransportKind(config: McpServerConfig): McpServerTransportKind {
  if (!isRemoteMcpServerConfig(config)) return 'stdio';
  return config.type === 'sse' ? 'sse' : 'http';
}

/**
 * What to show for a server in status lists: the command for stdio, the URL
 * for remote servers with credentials and the query string removed (both
 * commonly carry tokens).
 */
export function describeMcpServerEndpoint(config: McpServerConfig): string {
  if (!isRemoteMcpServerConfig(config)) return config.command;
  try {
    const parsed = new URL(config.url);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return config.url.split(/[?#]/, 1)[0] ?? config.url;
  }
}

/** One-line launch description: `command args…` for stdio, the redacted URL for remote. */
export function describeMcpServerLaunch(config: McpServerConfig): string {
  if (isRemoteMcpServerConfig(config)) return describeMcpServerEndpoint(config);
  return [config.command, ...(config.args ?? [])].join(' ').trim();
}

export type McpConfigDocument = {
  mcpServers: Record<string, McpServerConfig>;
  /** Exact `${serverId}.${toolName}` selectors exposed as direct tools. */
  pinnedSelectors?: string[];
};

export type McpToolSummary = {
  serverId: string;
  name: string;
  /** Prefixed tool name exposed to the agent: mcp__<server>__<tool> */
  exposedName: string;
  description: string;
  /** Optional JSON Schema from tools/list when available. */
  inputSchema?: Record<string, unknown>;
  /** True only when upstream `annotations.readOnlyHint` was explicitly true. */
  readOnlyHint?: boolean;
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
  /** True only when upstream `annotations.readOnlyHint` was explicitly true. */
  readOnlyHint?: boolean;
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

/** Direct-tool exposure policy for the gateway-first MCP surface. */
export type McpExposurePolicy = {
  mode: 'gateway' | 'pinned';
  maxDirectTools: number;
  maxDirectSchemaBytes: number;
  pinnedSelectors: string[];
};

export function createDefaultMcpExposurePolicy(): McpExposurePolicy {
  return {
    mode: 'gateway',
    maxDirectTools: 48,
    maxDirectSchemaBytes: 48_000,
    pinnedSelectors: [],
  };
}

/** Host-owned MCP process lifecycle status. */
export type McpServerRuntimeStatus =
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'running'
  | 'error'
  | 'disabled';

export type McpServerHealth = {
  serverId: string;
  status: McpServerRuntimeStatus;
  /** Display endpoint: the command for stdio, a redacted URL for remote servers. */
  command: string;
  transport?: McpServerTransportKind;
  disabled: boolean;
  toolCount: number;
  lastError?: string;
  startedAt?: string;
  pid?: number;
  /** Failure cooldown deadline, serialized as an ISO timestamp. */
  unhealthyUntil?: string;
};

export type McpConfigApplyReport = {
  changedServerIds: string[];
  exposureChanged: boolean;
  warnings: string[];
};

export type InstallSource =
  | { kind: 'local'; path: string }
  | { kind: 'git'; url: string; ref?: string; subdir?: string };
