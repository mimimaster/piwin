/**
 * Official MCP client via @modelcontextprotocol/sdk.
 * The SDK Client is retained for protocol behavior; stdio ownership is
 * provided by OwnedMcpStdioTransport so the Supervisor owns the full tree.
 */
import type { McpServerConfig } from '@piwin/contracts';
import { expandEnvMap } from './mcp-config.js';
import { OwnedMcpStdioTransport } from './owned-mcp-stdio-transport.js';
import type {
  McpListedTool,
  McpOwnedProcess,
  McpTransportClient,
} from './mcp-transport.js';

function toStringEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

export async function spawnOfficialMcpStdio(
  serverId: string,
  config: McpServerConfig,
  signal?: AbortSignal,
): Promise<McpOwnedProcess> {
  if (signal?.aborted) {
    throw new Error(`MCP connect aborted: ${serverId}`);
  }
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const transport = new OwnedMcpStdioTransport({
    command: config.command,
    args: config.args ?? [],
    env: {
      ...toStringEnv(process.env),
      ...expandEnvMap(config.env),
    },
  });

  const client = new Client(
    { name: 'piwin', version: '0.0.0' },
    { capabilities: {} },
  );

  let intentionalClose = false;
  let closePromise: Promise<void> | null = null;
  const abortConnect = (): void => {
    void closeOwnedProcess();
  };
  signal?.addEventListener('abort', abortConnect, { once: true });
  const exitHandlers = new Set<(reason: string) => void>();
  let exitNotified = false;
  let exitReason = `MCP server ${serverId} closed`;
  function notifyExit(reason: string): void {
    if (exitNotified || intentionalClose) {
      return;
    }
    exitNotified = true;
    exitReason = reason;
    for (const handler of exitHandlers) {
      try {
        handler(reason);
      } catch {
        // never let handler failures break the client
      }
    }
  }

  const previousOnClose = transport.onclose;
  transport.onclose = () => {
    previousOnClose?.();
    notifyExit(`MCP server ${serverId} closed`);
  };
  const previousOnError = transport.onerror;
  transport.onerror = (error) => {
    previousOnError?.(error);
    notifyExit(error.message || `MCP server ${serverId} error`);
  };

  async function closeOwnedProcess(): Promise<void> {
    if (closePromise) {
      return closePromise;
    }
    intentionalClose = true;
    closePromise = (async () => {
      try {
        await client.close();
      } catch {
        // Transport close remains authoritative if protocol shutdown fails.
      }
      await transport.close();
    })();
    return closePromise;
  }

  const ready = (async (): Promise<McpTransportClient> => {
    try {
      await client.connect(transport);
      const session: McpTransportClient = {
        serverId,
        async listTools(operationSignal) {
          const result = await client.listTools(
            {},
            operationSignal ? { signal: operationSignal } : undefined,
          );
          return (result.tools ?? []).map((tool) => {
            const item: McpListedTool = { name: tool.name };
            if (typeof tool.description === 'string') {
              item.description = tool.description;
            }
            if (tool.inputSchema && typeof tool.inputSchema === 'object') {
              item.inputSchema = tool.inputSchema as Record<string, unknown>;
            }
            return item;
          });
        },
        async callTool(name, args, operationSignal) {
          return client.callTool(
            { name, arguments: args },
            undefined,
            operationSignal ? { signal: operationSignal } : undefined,
          );
        },
        close: closeOwnedProcess,
        onExit(handler) {
          exitHandlers.add(handler);
          if (exitNotified && !intentionalClose) {
            queueMicrotask(() => {
              if (!intentionalClose && exitHandlers.has(handler)) {
                handler(exitReason);
              }
            });
          }
          return () => {
            exitHandlers.delete(handler);
          };
        },
      };
      if (transport.pid !== undefined) {
        session.pid = transport.pid;
      }
      return session;
    } catch (error) {
      await closeOwnedProcess();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abortConnect);
    }
  })();

  // Keep rejection handled even if a caller closes the owned handle without
  // awaiting readiness; the returned promise remains awaitable by the owner.
  void ready.catch(() => undefined);
  return {
    get pid(): number | undefined {
      return transport.pid;
    },
    ready,
    close: closeOwnedProcess,
  };
}

export async function connectOfficialMcpStdio(
  serverId: string,
  config: McpServerConfig,
  signal?: AbortSignal,
): Promise<McpTransportClient> {
  const owned = await spawnOfficialMcpStdio(serverId, config, signal);
  try {
    return await owned.ready;
  } catch (error) {
    await owned.close();
    throw error;
  }
}
