/** Explicit non-paid probe of the new safe MCP projection, never a readiness auto-test. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AcpClient, GROK_DROPPED_NOTIFICATION_METHODS, JsonRpcConnection, projectGrokMcpStatus } from '@piwin/acp-agent';
import type { ExternalAgentMcpServerStatus } from '@piwin/contracts';
import { detectGrokCli } from '../src/grok/grok-cli-detection.js';
import { createGrokProcessTransport } from '../src/grok/grok-process-transport.js';

const status = await detectGrokCli();
if (status.state !== 'ready') throw new Error(`Grok MCP smoke unavailable: ${status.state}`);
const cwd = await mkdtemp(join(tmpdir(), 'piwin-grok-mcp-smoke-'));
const connection = new JsonRpcConnection(createGrokProcessTransport({ binaryPath: status.binaryPath, cwd }), { droppedNotificationMethods: GROK_DROPPED_NOTIFICATION_METHODS, defaultTimeoutMs: 30_000 });
const client = new AcpClient(connection);
const shapes = new Set<string>();
const states = new Set<string>();
const safeEnums = new Set(['pending', 'initializing', 'disabled', 'connected', 'connecting', 'disconnected', 'failed', 'error', 'ready', 'starting', 'stopped', 'ok', 'success', 'degraded', 'unavailable', 'auth_required', 'needs_auth', 'failed_to_connect', 'unsupported', 'offline', 'online', 'Ready', 'Failed', 'Connected', 'ConfigError', 'Pending', 'Initializing', 'Disabled']);
const servers = new Map<string, ExternalAgentMcpServerStatus>();
connection.onNotification((method, params) => {
  if (method !== '_x.ai/mcp/server_status') return;
  if (typeof params === 'object' && params !== null) {
    shapes.add(Object.keys(params).sort().join(','));
    const raw = (params as Record<string, unknown>).status;
    states.add(typeof raw === 'string' && safeEnums.has(raw) ? raw : typeof raw === 'object' && raw !== null ? `object:${Object.keys(raw).sort().join(',')}` : `unrecognized-${typeof raw}`);
  }
  const projected = projectGrokMcpStatus(params);
  if (projected) servers.set(projected.name, projected);
});
let sessionId: string | undefined;
try {
  await client.initialize({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'piwin-mcp-smoke', version: '0' } });
  sessionId = (await client.newSession({ cwd, mcpServers: [] })).sessionId;
  for (let attempt = 0; attempt < 20 && shapes.size === 0; attempt++) await delay(200);
  console.log(JSON.stringify({ cliVersion: status.version, paidPrompts: 0, wireShapes: [...shapes], safeStatusEnums: [...states], servers: [...servers.values()] }, null, 2));
} finally {
  try { if (sessionId) await client.xaiDeleteSession(sessionId); }
  finally { await connection.close(); await rm(cwd, { recursive: true, force: true }); }
}
