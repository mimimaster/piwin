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
};

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
