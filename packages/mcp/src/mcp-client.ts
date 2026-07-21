import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpServerConfig, McpToolSummary } from '@piwin/contracts';
import { expandEnvMap } from './mcp-config.js';
import { toMcpToolSummary } from './tool-names.js';
import type {
  CreateMcpClientOptions,
  McpClientKind,
  McpListedTool,
  McpTransportClient,
} from './mcp-transport.js';

/**
 * Minimal JSON-RPC over stdio MCP client.
 * Prefer @modelcontextprotocol/sdk when fully wired; this path keeps M4 testable
 * without requiring the SDK at package-load time if install fails.
 */
export async function connectHandcraftedMcpStdio(
  serverId: string,
  config: McpServerConfig,
): Promise<McpTransportClient> {
  const env = {
    ...process.env,
    ...expandEnvMap(config.env),
  };
  const child = spawn(config.command, config.args ?? [], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  let buffer = '';
  let closed = false;
  let intentionalClose = false;
  const exitHandlers = new Set<(reason: string) => void>();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      handleMessage(line);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', () => {
    // Keep stderr for debugging; do not treat as fatal.
  });

  child.on('error', (error) => {
    failAll(error instanceof Error ? error : new Error(String(error)));
  });

  child.on('close', () => {
    closed = true;
    failAll(new Error(`MCP server ${serverId} exited`));
    if (!intentionalClose) {
      notifyExit(`MCP server ${serverId} exited`);
    }
  });
  function notifyExit(reason: string): void {
    for (const handler of exitHandlers) {
      try {
        handler(reason);
      } catch {
        // never let handler failures break the client
      }
    }
  }

  function handleMessage(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }
    const record = message as Record<string, unknown>;
    if (typeof record.id === 'number' && pending.has(record.id)) {
      const entry = pending.get(record.id);
      pending.delete(record.id);
      if (!entry) {
        return;
      }
      if (record.error) {
        const errObj = record.error as { message?: string };
        entry.reject(new Error(errObj.message ?? `MCP error for ${serverId}`));
        return;
      }
      entry.resolve(record.result);
    }
  }

  function failAll(error: Error): void {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  }

  function send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (closed) {
      return Promise.reject(new Error(`MCP server ${serverId} is closed`));
    }
    const id = nextId;
    nextId += 1;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params: params ?? {},
    };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (writeError) => {
        if (writeError) {
          pending.delete(id);
          reject(writeError);
        }
      });
    });
  }

  // Initialize handshake (MCP lifecycle)
  try {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'piwin', version: '0.0.0' },
    });
    // notifications/initialized (no id)
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      })}\n`,
    );
  } catch (error) {
    await closeChild(child);
    throw error;
  }

  const session: McpTransportClient = {
    serverId,
    async listTools() {
      const result = (await send('tools/list', {})) as {
        tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
      };
      return (result.tools ?? []).map((tool) => {
        const item: McpListedTool = { name: tool.name };
        if (typeof tool.description === 'string') {
          item.description = tool.description;
        }
        if (tool.inputSchema && typeof tool.inputSchema === 'object') {
          item.inputSchema = tool.inputSchema;
        }
        return item;
      });
    },
    async callTool(name, args) {
      return send('tools/call', { name, arguments: args });
    },
    async close() {
      intentionalClose = true;
      await closeChild(child);
    },
    onExit(handler) {
      exitHandlers.add(handler);
      if (closed && !intentionalClose) {
        // Already exited before subscribe — notify next tick so manager can wire first.
        queueMicrotask(() => {
          if (!intentionalClose) {
            handler(`MCP server ${serverId} already exited`);
          }
        });
      }
      return () => {
        exitHandlers.delete(handler);
      };
    },
  };
  if (typeof child.pid === 'number') {
    session.pid = child.pid;
  }
  return session;
}

/**
 * Connect to an MCP server over stdio.
 * Default: try official SDK, fall back to handcrafted NDJSON client.
 *
 * Override with options.prefer or env PIWIN_MCP_CLIENT=official|handcrafted|auto.
 */
export async function connectMcpStdio(
  serverId: string,
  config: McpServerConfig,
  options: CreateMcpClientOptions = {},
): Promise<McpTransportClient> {
  const prefer = resolveClientPreference(options.prefer);

  if (prefer === 'handcrafted') {
    return connectHandcraftedMcpStdio(serverId, config);
  }

  if (prefer === 'official') {
    const { connectOfficialMcpStdio } = await import('./mcp-client-official.js');
    return connectOfficialMcpStdio(serverId, config);
  }

  // auto: official first, handcrafted fallback
  try {
    const { connectOfficialMcpStdio } = await import('./mcp-client-official.js');
    return await withTimeout(
      connectOfficialMcpStdio(serverId, config),
      8_000,
      `official MCP connect timeout for ${serverId}`,
    );
  } catch (officialError) {
    const officialMessage =
      officialError instanceof Error ? officialError.message : String(officialError);
    try {
      const client = await connectHandcraftedMcpStdio(serverId, config);
      console.warn(
        `[piwin/mcp] official MCP client failed for ${serverId} (${officialMessage}); using handcrafted fallback`,
      );
      return client;
    } catch (handcraftedError) {
      const handcraftedMessage =
        handcraftedError instanceof Error
          ? handcraftedError.message
          : String(handcraftedError);
      throw new Error(
        `MCP connect failed for ${serverId}: official=${officialMessage}; handcrafted=${handcraftedMessage}`,
      );
    }
  }
}

function resolveClientPreference(
  prefer: CreateMcpClientOptions['prefer'],
): McpClientKind | 'auto' {
  if (prefer === 'official' || prefer === 'handcrafted' || prefer === 'auto') {
    return prefer;
  }
  const fromEnv = process.env.PIWIN_MCP_CLIENT?.trim().toLowerCase();
  if (fromEnv === 'official' || fromEnv === 'handcrafted' || fromEnv === 'auto') {
    return fromEnv;
  }
  return 'auto';
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function listToolsForServer(
  serverId: string,
  config: McpServerConfig,
): Promise<McpToolSummary[]> {
  if (config.disabled) {
    return [];
  }
  const session = await connectMcpStdio(serverId, config);
  try {
    const tools = await session.listTools();
    return tools.map((tool) =>
      toMcpToolSummary(serverId, tool.name, tool.description ?? ''),
    );
  } finally {
    await session.close();
  }
}

async function closeChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.killed) {
    return;
  }
  child.stdin.end();
  child.kill('SIGTERM');
}
