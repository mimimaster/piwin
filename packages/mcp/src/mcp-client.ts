import { spawn } from 'node:child_process';
import type { McpServerConfig, McpToolSummary } from '@piwin/contracts';
import { expandEnvMap } from './mcp-config.js';
import { isMcpRemoteBridge } from './mcp-connection-policy.js';
import { closeMcpProcessTree } from './mcp-process-tree.js';
import { toMcpToolSummary } from './tool-names.js';
import type {
  CreateMcpClientOptions,
  McpClientKind,
  McpListedTool,
  McpOwnedProcess,
  McpTransportClient,
} from './mcp-transport.js';

/**
 * Minimal JSON-RPC over stdio MCP client.
 * Prefer @modelcontextprotocol/sdk when fully wired; this path keeps M4 testable
 * without requiring the SDK at package-load time if install fails.
 */
export function spawnHandcraftedMcpStdio(
  serverId: string,
  config: McpServerConfig,
  signal?: AbortSignal,
): McpOwnedProcess {
  if (signal?.aborted) {
    const error = Promise.reject<McpTransportClient>(
      new Error(`MCP connect aborted: ${serverId}`),
    );
    return {
      pid: undefined,
      ready: error,
      close: async () => undefined,
    };
  }
  const env = {
    ...process.env,
    ...expandEnvMap(config.env),
  };
  const child = spawn(config.command, config.args ?? [], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Give local compatibility transports their own process group so close
    // can terminate npx/node descendants together on Unix.
    detached: process.platform !== 'win32',
  });
  const spawnedPid = child.pid ?? undefined;

  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  let buffer = '';
  let closed = false;
  let intentionalClose = false;
  let closePromise: Promise<void> | null = null;
  const exitHandlers = new Set<(reason: string) => void>();

  function closeOwnedProcess(): Promise<void> {
    intentionalClose = true;
    closePromise ??= closeMcpProcessTree(child, spawnedPid);
    return closePromise;
  }

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

  function send(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (closed) {
      return Promise.reject(new Error(`MCP server ${serverId} is closed`));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error(`MCP operation aborted: ${serverId}`));
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
      const abortHandler = (): void => {
        pending.delete(id);
        reject(new Error(`MCP operation aborted: ${serverId}`));
        // Abort is the caller's cancellation edge; the Supervisor still
        // awaits the owned handle through the enclosing ready/call path.
        void closeOwnedProcess();
      };
      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
      pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener('abort', abortHandler);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abortHandler);
          reject(error);
        },
      });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (writeError) => {
        if (writeError) {
          pending.delete(id);
          signal?.removeEventListener('abort', abortHandler);
          reject(writeError);
        }
      });
    });
  }

  const ready = (async (): Promise<McpTransportClient> => {
    try {
      await send(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'piwin', version: '0.0.0' },
        },
        signal,
      );
      // notifications/initialized (no id)
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        })}\n`,
      );

      const session: McpTransportClient = {
        serverId,
        async listTools(operationSignal) {
          const result = (await send('tools/list', {}, operationSignal)) as {
            tools?: Array<{
              name: string;
              description?: string;
              inputSchema?: Record<string, unknown>;
            }>;
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
        async callTool(name, args, operationSignal) {
          return send('tools/call', { name, arguments: args }, operationSignal);
        },
        async close() {
          await closeOwnedProcess();
        },
        onExit(handler) {
          exitHandlers.add(handler);
          if (closed && !intentionalClose) {
            // Already exited before subscribe — notify next tick so the manager can wire first.
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
      if (spawnedPid !== undefined) {
        session.pid = spawnedPid;
      }
      return session;
    } catch (error) {
      await closeOwnedProcess();
      throw error;
    }
  })();

  // The supervisor normally awaits this promise. Attach a rejection handler as
  // well so a caller that only wants to close a failed handle cannot create an
  // unhandled-rejection process warning.
  // Keep rejection handled for a close-before-ready caller.
  void ready.catch(() => undefined);
  return {
    get pid(): number | undefined {
      return spawnedPid;
    },
    ready,
    close: closeOwnedProcess,
  };
}

export async function connectHandcraftedMcpStdio(
  serverId: string,
  config: McpServerConfig,
  signal?: AbortSignal,
): Promise<McpTransportClient> {
  const owned = spawnHandcraftedMcpStdio(serverId, config, signal);
  try {
    return await owned.ready;
  } catch (error) {
    await owned.close();
    throw error;
  }
}

/**
 * Connect to an MCP server over stdio.
 * Default: try official SDK, fall back to handcrafted NDJSON client.
 *
 * Override with options.prefer or env PIWIN_MCP_CLIENT=official|handcrafted|auto.
 */
export function spawnMcpStdio(
  serverId: string,
  config: McpServerConfig,
  options: CreateMcpClientOptions = {},
): McpOwnedProcess {
  if (options.signal?.aborted) {
    const ready = Promise.reject<McpTransportClient>(
      new Error(`MCP connect aborted: ${serverId}`),
    );
    return { pid: undefined, ready, close: async () => undefined };
  }
  const requestedPreference = resolveClientPreference(options.prefer);
  // OAuth must keep one process alive until the browser callback completes.
  const prefer =
    requestedPreference === 'auto' && isMcpRemoteBridge(config) ? 'official' : requestedPreference;

  let currentProcess: McpOwnedProcess | null = null;
  let closeRequested = false;
  let resolveProcessCreated: (() => void) | undefined;
  const processCreated = new Promise<void>((resolve) => {
    resolveProcessCreated = resolve;
  });

  async function awaitProcess(
    processPromise: Promise<McpOwnedProcess>,
  ): Promise<McpTransportClient> {
    const owned = await processPromise;
    currentProcess = owned;
    resolveProcessCreated?.();
    if (closeRequested) {
      await owned.close();
      throw new Error(`MCP connect aborted: ${serverId}`);
    }
    return owned.ready;
  }

  const ready = (async (): Promise<McpTransportClient> => {
    try {
      if (prefer === 'handcrafted') {
        return await awaitProcess(
          Promise.resolve(spawnHandcraftedMcpStdio(serverId, config, options.signal)),
        );
      }

      const { spawnOfficialMcpStdio } = await import('./mcp-client-official.js');
      if (prefer === 'official') {
        return await awaitProcess(spawnOfficialMcpStdio(serverId, config, options.signal));
      }

      // auto: official first, handcrafted fallback. The wrapper remains the
      // owned handle throughout the fallback so the supervisor never loses
      // the process it must close.
      let officialError: unknown;
      try {
        const officialProcess = await spawnOfficialMcpStdio(
          serverId,
          config,
          options.signal,
        );
        currentProcess = officialProcess;
        resolveProcessCreated?.();
        if (closeRequested) {
          await officialProcess.close();
          throw new Error(`MCP connect aborted: ${serverId}`);
        }
        return await officialProcess.ready;
      } catch (error) {
        officialError = error;
        await currentProcess?.close();
        if (closeRequested || options.signal?.aborted) {
          throw error;
        }
      }

      const officialMessage =
        officialError instanceof Error ? officialError.message : String(officialError);
      const handcraftedProcess = spawnHandcraftedMcpStdio(
        serverId,
        config,
        options.signal,
      );
      currentProcess = handcraftedProcess;
      resolveProcessCreated?.();
      if (closeRequested) {
        await handcraftedProcess.close();
        throw new Error(`MCP connect aborted: ${serverId}`);
      }
      try {
        const client = await handcraftedProcess.ready;
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
    } finally {
      resolveProcessCreated?.();
    }
  })();

  void ready.catch(() => undefined);
  return {
    get pid(): number | undefined {
      return currentProcess?.pid;
    },
    ready,
    close: async () => {
      closeRequested = true;
      await processCreated;
      await currentProcess?.close();
    },
  };
}

export async function connectMcpStdio(
  serverId: string,
  config: McpServerConfig,
  options: CreateMcpClientOptions = {},
): Promise<McpTransportClient> {
  const owned = spawnMcpStdio(serverId, config, options);
  try {
    return await owned.ready;
  } catch (error) {
    await owned.close();
    throw error;
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
