/**
 * Host-owned MCP process lifecycle manager.
 * Long-lived stdio clients for health/start/stop UI + session tool bridge reuse.
 *
 * Watchdog (light): unexpected process exit → status=error; optional single
 * restart when McpServerConfig.restartOnCrash is true.
 */
import type {
  McpConfigDocument,
  McpServerConfig,
  McpServerHealth,
  McpServerRuntimeStatus,
  McpToolSummary,
} from '@piwin/contracts';
import { loadMcpConfig } from './mcp-config.js';
import { connectMcpStdio } from './mcp-client.js';
import type { McpTransportClient } from './mcp-transport.js';
import { toMcpToolSummary } from './tool-names.js';

/** Backoff before a single crash restart (ms). */
const CRASH_RESTART_BACKOFF_MS = 500;

type RuntimeEntry = {
  serverId: string;
  config: McpServerConfig;
  status: McpServerRuntimeStatus;
  client: McpTransportClient | null;
  toolCount: number;
  lastError?: string;
  startedAt?: string;
  pid?: number;
  startPromise?: Promise<void>;
  /** True while stop()/dispose() intentionally closes the client. */
  intentionalStop: boolean;
  /** Whether the single crash-restart budget has been used for this run. */
  crashRestartUsed: boolean;
  exitUnsubscribe?: () => void;
};

export type McpLifecycleManager = {
  refreshConfig: () => Promise<McpConfigDocument>;
  listHealth: () => Promise<McpServerHealth[]>;
  start: (serverId: string) => Promise<McpServerHealth>;
  stop: (serverId: string) => Promise<McpServerHealth>;
  ensureStarted: (serverId: string) => Promise<McpTransportClient>;
  getClient: (serverId: string) => McpTransportClient | null;
  listTools: (serverId: string) => Promise<McpToolSummary[]>;
  dispose: () => Promise<void>;
};

function clearRuntimeFields(entry: RuntimeEntry): void {
  if (entry.exitUnsubscribe) {
    entry.exitUnsubscribe();
    delete entry.exitUnsubscribe;
  }
  entry.client = null;
  entry.toolCount = 0;
  delete entry.pid;
  delete entry.startedAt;
  delete entry.lastError;
  delete entry.startPromise;
}

export function createMcpLifecycleManager(piwinRoot: string): McpLifecycleManager {
  const entries = new Map<string, RuntimeEntry>();
  let document: McpConfigDocument = { mcpServers: {} };
  let disposed = false;

  async function refreshConfig(): Promise<McpConfigDocument> {
    document = await loadMcpConfig(piwinRoot);
    for (const [serverId, config] of Object.entries(document.mcpServers)) {
      const existing = entries.get(serverId);
      if (!existing) {
        entries.set(serverId, {
          serverId,
          config,
          status: config.disabled ? 'disabled' : 'stopped',
          client: null,
          toolCount: 0,
          intentionalStop: false,
          crashRestartUsed: false,
        });
        continue;
      }
      existing.config = config;
      if (config.disabled) {
        if (existing.client) {
          existing.intentionalStop = true;
          await safeClose(existing.client);
        }
        clearRuntimeFields(existing);
        existing.status = 'disabled';
      } else if (existing.status === 'disabled') {
        existing.status = 'stopped';
      }
    }
    for (const serverId of [...entries.keys()]) {
      if (!(serverId in document.mcpServers)) {
        const entry = entries.get(serverId);
        if (entry?.client) {
          entry.intentionalStop = true;
          await safeClose(entry.client);
        }
        if (entry) {
          clearRuntimeFields(entry);
        }
        entries.delete(serverId);
      }
    }
    return document;
  }

  function toHealth(entry: RuntimeEntry): McpServerHealth {
    const health: McpServerHealth = {
      serverId: entry.serverId,
      status: entry.status,
      command: entry.config.command,
      disabled: entry.config.disabled === true,
      toolCount: entry.toolCount,
    };
    if (entry.lastError) {
      health.lastError = entry.lastError;
    }
    if (entry.startedAt) {
      health.startedAt = entry.startedAt;
    }
    if (entry.pid !== undefined) {
      health.pid = entry.pid;
    }
    return health;
  }

  async function listHealth(): Promise<McpServerHealth[]> {
    await refreshConfig();
    return [...entries.values()]
      .map(toHealth)
      .sort((left, right) => left.serverId.localeCompare(right.serverId));
  }

  function wireExitWatchdog(entry: RuntimeEntry, client: McpTransportClient): void {
    if (entry.exitUnsubscribe) {
      entry.exitUnsubscribe();
      delete entry.exitUnsubscribe;
    }
    entry.exitUnsubscribe = client.onExit((reason) => {
      if (disposed || entry.intentionalStop) {
        return;
      }
      // Unexpected crash while marked running.
      void handleUnexpectedExit(entry, reason);
    });
  }

  async function handleUnexpectedExit(
    entry: RuntimeEntry,
    reason: string,
  ): Promise<void> {
    if (disposed || entry.intentionalStop) {
      return;
    }
    // Drop dead client without calling close (process already gone).
    if (entry.exitUnsubscribe) {
      entry.exitUnsubscribe();
      delete entry.exitUnsubscribe;
    }
    entry.client = null;
    entry.toolCount = 0;
    delete entry.pid;
    delete entry.startedAt;
    delete entry.startPromise;
    entry.status = 'error';
    entry.lastError = reason;

    const shouldRestart =
      entry.config.restartOnCrash === true && !entry.crashRestartUsed;
    if (!shouldRestart) {
      return;
    }

    entry.crashRestartUsed = true;
    entry.status = 'starting';
    entry.lastError = `${reason}; restarting once…`;
    await delay(CRASH_RESTART_BACKOFF_MS);
    if (disposed || entry.intentionalStop) {
      return;
    }
    try {
      await startInternal(entry, { resetCrashBudget: false });
    } catch (error) {
      entry.status = 'error';
      entry.lastError =
        error instanceof Error
          ? `restart after crash failed: ${error.message}`
          : `restart after crash failed: ${String(error)}`;
    }
  }

  async function startInternal(
    entry: RuntimeEntry,
    options: { resetCrashBudget: boolean },
  ): Promise<void> {
    if (entry.status === 'running' && entry.client) {
      return;
    }
    if (entry.startPromise) {
      await entry.startPromise;
      return;
    }

    entry.status = 'starting';
    entry.intentionalStop = false;
    if (options.resetCrashBudget) {
      entry.crashRestartUsed = false;
    }
    delete entry.lastError;

    const startPromise = (async () => {
      try {
        const client = await connectMcpStdio(entry.serverId, entry.config);
        if (disposed || entry.intentionalStop) {
          await safeClose(client);
          return;
        }
        const tools = await client.listTools();
        entry.client = client;
        entry.toolCount = tools.length;
        entry.status = 'running';
        entry.startedAt = new Date().toISOString();
        if (typeof client.pid === 'number') {
          entry.pid = client.pid;
        } else {
          delete entry.pid;
        }
        delete entry.lastError;
        wireExitWatchdog(entry, client);
      } catch (error) {
        clearRuntimeFields(entry);
        entry.status = 'error';
        entry.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        delete entry.startPromise;
      }
    })();
    entry.startPromise = startPromise;
    await startPromise;
  }

  async function start(serverId: string): Promise<McpServerHealth> {
    await refreshConfig();
    const entry = entries.get(serverId);
    if (!entry) {
      throw new Error(`unknown MCP server: ${serverId}`);
    }
    if (entry.config.disabled) {
      entry.status = 'disabled';
      return toHealth(entry);
    }
    if (entry.status === 'running' && entry.client) {
      return toHealth(entry);
    }

    try {
      await startInternal(entry, { resetCrashBudget: true });
    } catch {
      // health reflects error status
    }
    return toHealth(entry);
  }

  async function stop(serverId: string): Promise<McpServerHealth> {
    await refreshConfig();
    const entry = entries.get(serverId);
    if (!entry) {
      throw new Error(`unknown MCP server: ${serverId}`);
    }
    entry.intentionalStop = true;
    if (entry.client) {
      await safeClose(entry.client);
    }
    clearRuntimeFields(entry);
    entry.crashRestartUsed = false;
    entry.status = entry.config.disabled ? 'disabled' : 'stopped';
    return toHealth(entry);
  }

  async function ensureStarted(serverId: string): Promise<McpTransportClient> {
    const health = await start(serverId);
    const entry = entries.get(serverId);
    if (!entry?.client || health.status !== 'running') {
      throw new Error(
        health.lastError ?? `MCP server ${serverId} is not running (${health.status})`,
      );
    }
    return entry.client;
  }

  function getClient(serverId: string): McpTransportClient | null {
    return entries.get(serverId)?.client ?? null;
  }

  async function listTools(serverId: string): Promise<McpToolSummary[]> {
    await refreshConfig();
    const entry = entries.get(serverId);
    if (!entry) {
      throw new Error(`unknown MCP server: ${serverId}`);
    }
    if (entry.config.disabled) {
      return [];
    }
    const client = await ensureStarted(serverId);
    const tools = await client.listTools();
    entry.toolCount = tools.length;
    return tools.map((tool) =>
      toMcpToolSummary(serverId, tool.name, tool.description ?? ''),
    );
  }

  async function dispose(): Promise<void> {
    disposed = true;
    await Promise.all(
      [...entries.values()].map(async (entry) => {
        entry.intentionalStop = true;
        if (entry.client) {
          await safeClose(entry.client);
        }
        clearRuntimeFields(entry);
        entry.status = entry.config.disabled ? 'disabled' : 'stopped';
      }),
    );
  }

  return {
    refreshConfig,
    listHealth,
    start,
    stop,
    ensureStarted,
    getClient,
    listTools,
    dispose,
  };
}

async function safeClose(client: McpTransportClient): Promise<void> {
  try {
    await client.close();
  } catch {
    // ignore shutdown races
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
