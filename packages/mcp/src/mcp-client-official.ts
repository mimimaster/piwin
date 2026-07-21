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
): Promise<McpTransportClient> {
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

  await client.connect(transport);

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
    async listTools() {
      const result = await client.listTools();
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
    async callTool(name, args) {
      return client.callTool({ name, arguments: args });
    },
    async close() {
      intentionalClose = true;
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
