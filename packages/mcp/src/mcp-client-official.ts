/**
 * Official MCP stdio client via @modelcontextprotocol/sdk.
 * Uses Content-Length framed JSON-RPC (spec-compliant).
 */
import type { McpServerConfig } from '@piwin/contracts';
import { expandEnvMap } from './mcp-config.js';
import type { McpListedTool, McpTransportClient } from './mcp-transport.js';

function toStringEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

export async function connectOfficialMcpStdio(
  serverId: string,
  config: McpServerConfig,
  signal?: AbortSignal,
): Promise<McpTransportClient> {
  if (signal?.aborted) {
    throw new Error(`MCP connect aborted: ${serverId}`);
  }
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/stdio.js'
  );

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: {
      ...toStringEnv(process.env),
      ...expandEnvMap(config.env),
    },
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'piwin', version: '0.0.0' },
    { capabilities: {} },
  );

  const connectPid = transport.pid;
  try {
    await client.connect(transport, signal ? { signal } : undefined);
  } catch (error) {
    try {
      await transport.close();
    } catch {
      // Cleanup is best effort when connection setup is cancelled.
    }
    // Ensure the spawned process is dead — transport.close() may have
    // cleared its internal _process ref before sending SIGKILL.
    if (typeof connectPid === 'number') {
      try { process.kill(connectPid, 'SIGKILL'); } catch { /* already gone */ }
    }
    throw error;
  }

  let intentionalClose = false;
  const exitHandlers = new Set<(reason: string) => void>();
  let exitNotified = false;
  function notifyExit(reason: string): void {
    if (exitNotified || intentionalClose) {
      return;
    }
    exitNotified = true;
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

  const session: McpTransportClient = {
    serverId,
    async listTools(signal) {
      const result = await client.listTools({}, signal ? { signal } : undefined);
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
    async callTool(name, args, signal) {
      return client.callTool(
        { name, arguments: args },
        undefined,
        signal ? { signal } : undefined,
      );
    },
    async close() {
      intentionalClose = true;
      // Capture PID before transport.close() clears the internal _process ref.
      const pid = transport.pid;
      try {
        await client.close();
      } catch {
        // ignore close races
      }
      try {
        await transport.close();
      } catch {
        // ignore close races
      }
      // Hard-kill the underlying process if it survived the graceful close.
      // The SDK's transport.close() should handle SIGTERM → SIGKILL escalation,
      // but we add a belt-and-suspenders kill to prevent orphaned processes
      // when the transport's internal state is already cleared (e.g. after
      // a connect timeout where _process was set to undefined before kill).
      if (typeof pid === 'number') {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone or no permission
        }
      }
    },
    onExit(handler) {
      exitHandlers.add(handler);
      return () => {
        exitHandlers.delete(handler);
      };
    },
  };

  const processId = transport.pid;
  if (typeof processId === 'number') {
    session.pid = processId;
  }
  return session;
}
