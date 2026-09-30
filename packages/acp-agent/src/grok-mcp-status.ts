import type { ExternalAgentMcpServerStatus } from '@piwin/contracts';

const STATUSES = new Set(['connected', 'connecting', 'disconnected', 'failed', 'error', 'ready', 'starting', 'stopped', 'unavailable', 'pending', 'initializing', 'disabled']);
const TRANSPORTS = new Set(['stdio', 'http', 'sse']);

/** Never copy raw error reasons: they can echo env values, headers or credentials. */
export function projectGrokMcpStatus(params: unknown): ExternalAgentMcpServerStatus | undefined {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return undefined;
  const input = params as Record<string, unknown>;
  const name = input.name ?? input.serverName ?? input.serverId;
  if (typeof name !== 'string' || !name.trim() || name.length > 160 || /[\r\n\0]/.test(name)) return undefined;
  if (typeof input.status !== 'string' || !STATUSES.has(input.status)) return undefined;
  const detail = typeof input.detail === 'object' && input.detail !== null ? input.detail as Record<string, unknown> : undefined;
  const reportedTransport = input.transport ?? detail?.transport;
  const transport = typeof reportedTransport === 'string' && TRANSPORTS.has(reportedTransport) ? reportedTransport : undefined;
  return {
    name, status: input.status,
    ...(transport ? { transport } : {}),
    ...(input.status === 'failed' || input.status === 'error' || input.status === 'unavailable' ? { reason: 'Grok reported a connection error. Inspect the server on the Host with grok mcp.' } : {}),
  };
}
