/**
 * Remote MCP client over Streamable HTTP or legacy HTTP+SSE (official SDK).
 *
 * There is no child process: `pid` stays undefined and closing ends the HTTP
 * session. The supervisor treats a dropped connection like a stdio exit, so
 * crash cooldown and the single `restartOnCrash` retry behave the same.
 */
import type { McpRemoteServerConfig } from '@piwin/contracts';
import type { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { expandEnvMap } from './mcp-config.js';
import { readOnlyHintOf } from './mcp-tool-annotations.js';
import type { McpListedTool, McpOwnedProcess, McpTransportClient } from './mcp-transport.js';

type RemoteTransportKind = 'http' | 'sse';

/** HTTP statuses that mean "this endpoint does not speak Streamable HTTP". */
const STREAMABLE_HTTP_UNSUPPORTED_STATUSES = new Set([400, 404, 405]);

export function spawnRemoteMcp(
  serverId: string,
  config: McpRemoteServerConfig,
  signal?: AbortSignal,
): McpOwnedProcess {
  let closeRequested = false;
  let activeClose: (() => Promise<void>) | undefined;

  const ready = (async (): Promise<McpTransportClient> => {
    if (signal?.aborted) {
      throw new Error(`MCP connect aborted: ${serverId}`);
    }
    const url = parseRemoteUrl(serverId, config.url);
    const headers = expandEnvMap(config.headers);
    const order: RemoteTransportKind[] =
      config.type === 'sse' ? ['sse'] : config.type === 'http' ? ['http'] : ['http', 'sse'];
    let lastError: unknown;
    for (const kind of order) {
      try {
        return await connectOnce(serverId, url, headers, kind, signal, (close) => {
          activeClose = close;
          return closeRequested;
        });
      } catch (error) {
        lastError = error;
        const canFallBack =
          kind === 'http' &&
          order.includes('sse') &&
          !closeRequested &&
          signal?.aborted !== true &&
          isStreamableHttpUnsupported(error);
        if (!canFallBack) break;
      }
    }
    throw new Error(
      `MCP connect failed for ${serverId} at ${redactUrl(url)}: ${errorMessage(lastError)}`,
    );
  })();

  void ready.catch(() => undefined);
  return {
    pid: undefined,
    ready,
    close: async () => {
      closeRequested = true;
      await activeClose?.();
    },
  };
}

async function connectOnce(
  serverId: string,
  url: URL,
  headers: Record<string, string>,
  kind: RemoteTransportKind,
  signal: AbortSignal | undefined,
  registerClose: (close: () => Promise<void>) => boolean,
): Promise<McpTransportClient> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const requestInit: RequestInit = { headers };
  let transport: SSEClientTransport | StreamableHTTPClientTransport;
  let terminateSession: (() => Promise<void>) | undefined;
  if (kind === 'sse') {
    const sse = await import('@modelcontextprotocol/sdk/client/sse.js');
    transport = new sse.SSEClientTransport(url, {
      requestInit,
      // EventSource cannot send headers itself; the SDK takes a fetch override.
      eventSourceInit: { fetch: (input, init) => fetchWithHeaders(input, init, headers) },
    });
  } else {
    const http = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const streamable = new http.StreamableHTTPClientTransport(url, { requestInit });
    transport = streamable;
    terminateSession = () => streamable.terminateSession();
  }
  const client = new Client({ name: 'piwin', version: '0.0.0' }, { capabilities: {} });

  let intentionalClose = false;
  let closePromise: Promise<void> | undefined;
  const exitHandlers = new Set<(reason: string) => void>();
  let exitReason: string | undefined;

  function notifyExit(reason: string): void {
    if (exitReason !== undefined || intentionalClose) return;
    exitReason = reason;
    for (const handler of exitHandlers) {
      try {
        handler(reason);
      } catch (error) {
        console.warn(`[piwin/mcp] exit handler for ${serverId} threw: ${errorMessage(error)}`);
      }
    }
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    intentionalClose = true;
    closePromise = (async () => {
      // Streamable HTTP: tell the server the session is over. A server without
      // session support answers 405; the local close below still completes.
      await terminateSession?.().catch((error: unknown) => {
        console.warn(`[piwin/mcp] ending session for ${serverId} failed: ${errorMessage(error)}`);
      });
      await client.close().catch((error: unknown) => {
        console.warn(`[piwin/mcp] closing ${serverId} failed: ${errorMessage(error)}`);
      });
    })();
    return closePromise;
  }

  // An HTTP transport reports transient stream errors through onerror and
  // reconnects itself; only onclose means the session is gone.
  const previousOnClose = transport.onclose;
  transport.onclose = () => {
    previousOnClose?.();
    notifyExit(`MCP server ${serverId} connection closed`);
  };

  const abortConnect = (): void => {
    void close();
  };
  signal?.addEventListener('abort', abortConnect, { once: true });
  if (registerClose(close)) {
    await close();
    throw new Error(`MCP connect aborted: ${serverId}`);
  }
  try {
    // The SDK's own transports declare `sessionId?: string`, which its
    // Transport interface rejects under exactOptionalPropertyTypes.
    await client.connect(transport as Transport);
  } catch (error) {
    await close();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abortConnect);
  }

  return {
    serverId,
    async listTools(operationSignal) {
      const result = await client.listTools(
        {},
        operationSignal ? { signal: operationSignal } : undefined,
      );
      return (result.tools ?? []).map((tool) => {
        const item: McpListedTool = { name: tool.name };
        if (typeof tool.description === 'string') item.description = tool.description;
        if (tool.inputSchema && typeof tool.inputSchema === 'object') {
          item.inputSchema = tool.inputSchema as Record<string, unknown>;
        }
        if (readOnlyHintOf(tool) === true) item.readOnlyHint = true;
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
    close,
    onExit(handler) {
      exitHandlers.add(handler);
      const reason = exitReason;
      if (reason !== undefined && !intentionalClose) {
        queueMicrotask(() => {
          if (!intentionalClose && exitHandlers.has(handler)) handler(reason);
        });
      }
      return () => {
        exitHandlers.delete(handler);
      };
    },
  };
}

function fetchWithHeaders(
  input: string | URL | Request,
  init: RequestInit | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  const merged = new Headers(init?.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return fetch(input, { ...init, headers: merged });
}

function parseRemoteUrl(serverId: string, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`MCP server ${serverId} has an invalid url`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`MCP server ${serverId} url must be http or https`);
  }
  return url;
}

/** The SDK reports a failed POST as StreamableHTTPError with the HTTP status in `code`. */
function isStreamableHttpUnsupported(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'number' && STREAMABLE_HTTP_UNSUPPORTED_STATUSES.has(code);
}

function redactUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
