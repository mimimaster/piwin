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
  listTools: (signal?: AbortSignal) => Promise<McpListedTool[]>;
  callTool: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  close: () => Promise<void>;
  /**
   * Notify when the underlying process exits after a successful connect.
   * Not fired for intentional `close()` when the implementation can distinguish.
   * Returns an unsubscribe function.
   */
  onExit: (handler: (reason: string) => void) => () => void;
};

/**
 * Process ownership returned before MCP readiness completes.
 * The supervisor registers this handle immediately, then awaits `ready`.
 * `close()` is safe before readiness and must settle after the child is gone
 * (or the transport has exhausted its shutdown deadline).
 */
export type McpOwnedProcess = {
  readonly pid: number | undefined;
  readonly ready: Promise<McpTransportClient>;
  close: () => Promise<void>;
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
  /** Abort connection setup when the owning foreground run is cancelled. */
  signal?: AbortSignal;
};
