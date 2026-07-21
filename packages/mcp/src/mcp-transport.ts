/**
 * Transport-agnostic MCP client surface used by lifecycle manager + session bridge.
 * Implementations: handcrafted JSON-RPC stdio, official @modelcontextprotocol/sdk.
 */
export type McpListedTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpTransportClient = {
  serverId: string;
  /** OS process id when available. */
  pid?: number;
  listTools: () => Promise<McpListedTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
  /**
   * Notify when the underlying process exits after a successful connect.
   * Not fired for intentional `close()` when the implementation can distinguish.
   * Returns an unsubscribe function.
   */
  onExit: (handler: (reason: string) => void) => () => void;
};

/** @deprecated Prefer McpTransportClient — kept as alias for existing call sites. */
export type McpClientSession = McpTransportClient;

export type McpClientKind = 'official' | 'handcrafted';

export type CreateMcpClientOptions = {
  /**
   * Force a transport implementation.
   * Default: try official SDK, fall back to handcrafted on failure.
   */
  prefer?: McpClientKind | 'auto';
};
