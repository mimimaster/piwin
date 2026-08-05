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
import { fingerprintMcpServerConfig } from './mcp-fingerprint.js';
import { createMcpMetadataCatalog, type McpMetadataCatalog } from './mcp-metadata-catalog.js';
import type { McpGenerationSnapshot } from './mcp-generation-snapshot.js';

/** Backoff before a single crash restart (ms). */
const CRASH_RESTART_BACKOFF_MS = 500;
/** Default connect/bootstrap deadline. */
const DEFAULT_CONNECT_TIMEOUT_MS = 12_000;
/** Default tools/list deadline. */
const DEFAULT_LIST_TOOLS_TIMEOUT_MS = 10_000;
/** Default tool call deadline. */
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

export type McpLifecycleManagerOptions = {
  connectTimeoutMs?: number;
  listToolsTimeoutMs?: number;
  callTimeoutMs?: number;
};

type RuntimeEntry = {
  serverId: string;
  /** Set only for generation-scoped entries; management entries use disk config. */
  generationId?: string;
  config: McpServerConfig;
  configFingerprint: string;
  status: McpServerRuntimeStatus;
  client: McpTransportClient | null;
  toolCount: number;
  lastError?: string;
  startedAt?: string;
  pid?: number;
  startPromise?: Promise<void>;
  startToken?: object;
  discoverPromise?: Promise<McpToolSummary[]>;
  /** True while stop()/dispose() intentionally closes the client. */
  intentionalStop: boolean;
  /** Whether the single crash-restart budget has been used for this run. */
  crashRestartUsed: boolean;
  exitUnsubscribe?: () => void;
};

export type McpLifecycleManager = {
  refreshConfig: () => Promise<McpConfigDocument>;
  listHealth: (snapshot?: McpGenerationSnapshot) => Promise<McpServerHealth[]>;
  start: (serverId: string, signal?: AbortSignal) => Promise<McpServerHealth>;
  stop: (serverId: string) => Promise<McpServerHealth>;
  /** Connect + initialize only (no tools/list). */
  ensureConnected: (serverId: string, signal?: AbortSignal) => Promise<McpTransportClient>;
  /** @deprecated Prefer ensureConnected — alias for compatibility. */
  ensureStarted: (serverId: string) => Promise<McpTransportClient>;
  getClient: (serverId: string) => McpTransportClient | null;
  listTools: (
    serverId: string,
    signal?: AbortSignal,
    snapshot?: McpGenerationSnapshot,
  ) => Promise<McpToolSummary[]>;
  /** Discover tools over a live connection and update the metadata catalog. */
  discoverTools: (
    serverId: string,
    signal?: AbortSignal,
    snapshot?: McpGenerationSnapshot,
  ) => Promise<McpToolSummary[]>;
  callTool: (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    snapshot?: McpGenerationSnapshot,
  ) => Promise<unknown>;
  /** Release transports owned by one generation without refreshing disk config. */
  releaseGenerationSnapshot: (generationId: string) => Promise<void>;
  getMetadataCatalog: () => McpMetadataCatalog;
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
  delete entry.startToken;
  delete entry.discoverPromise;
}

function detachClient(entry: RuntimeEntry): McpTransportClient | null {
  if (entry.exitUnsubscribe) {
    entry.exitUnsubscribe();
    delete entry.exitUnsubscribe;
  }
  const client = entry.client;
  entry.client = null;
  entry.toolCount = 0;
  delete entry.pid;
  delete entry.startedAt;
  return client;
}

export function createMcpLifecycleManager(
  piwinRoot: string,
  options: McpLifecycleManagerOptions = {},
): McpLifecycleManager {
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const listToolsTimeoutMs = options.listToolsTimeoutMs ?? DEFAULT_LIST_TOOLS_TIMEOUT_MS;
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const entries = new Map<string, RuntimeEntry>();
  const generationEntries = new Map<string, RuntimeEntry>();
  let document: McpConfigDocument = { mcpServers: {} };
  let disposed = false;
  const metadataCatalog = createMcpMetadataCatalog(piwinRoot);

  function createRuntimeEntry(
    serverId: string,
    config: McpServerConfig,
    generationId?: string,
  ): RuntimeEntry {
    return {
      serverId,
      ...(generationId ? { generationId } : {}),
      config,
      configFingerprint: fingerprintMcpServerConfig(serverId, config),
      status: config.disabled ? 'disabled' : 'stopped',
      client: null,
      toolCount: 0,
      intentionalStop: false,
      crashRestartUsed: false,
    };
  }

  async function refreshConfig(): Promise<McpConfigDocument> {
    document = await loadMcpConfig(piwinRoot);
    for (const [serverId, config] of Object.entries(document.mcpServers)) {
      const fingerprint = fingerprintMcpServerConfig(serverId, config);
      const existing = entries.get(serverId);
      if (!existing) {
        entries.set(serverId, createRuntimeEntry(serverId, config));
        continue;
      }
      if (existing.configFingerprint !== fingerprint) {
        // Config changed: detach immediately. A broken close must not block
        // calls for unrelated servers during this global config refresh.
        const previousClient = detachClient(existing);
        if (previousClient) {
          void closeWithDeadline(previousClient);
        }
        // Allow a new call to start the replacement configuration immediately;
        // the old in-flight start is guarded by its captured fingerprint.
        delete existing.startPromise;
        delete existing.startToken;
        delete existing.discoverPromise;
        void metadataCatalog.markServerStale(serverId);
        existing.status = config.disabled ? 'disabled' : 'stopped';
      }
      existing.config = config;
      existing.configFingerprint = fingerprint;
      if (config.disabled) {
        const previousClient = detachClient(existing);
        if (previousClient) {
          void closeWithDeadline(previousClient);
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
        if (entry) {
          const previousClient = detachClient(entry);
          if (previousClient) {
            void closeWithDeadline(previousClient);
          }
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

  function generationEntryKey(snapshot: McpGenerationSnapshot, serverId: string): string {
    return `${snapshot.generationId}\u0000${serverId}\u0000${snapshot.serverFingerprints[serverId] ?? ''}`;
  }

  function getGenerationEntry(
    snapshot: McpGenerationSnapshot,
    serverId: string,
  ): RuntimeEntry | undefined {
    const config = snapshot.config.mcpServers[serverId];
    if (!config) {
      return undefined;
    }
    const expectedFingerprint = snapshot.serverFingerprints[serverId];
    const actualFingerprint = fingerprintMcpServerConfig(serverId, config);
    if (!expectedFingerprint || actualFingerprint !== expectedFingerprint) {
      throw new Error(`MCP generation snapshot is internally inconsistent for ${serverId}`);
    }
    const key = generationEntryKey(snapshot, serverId);
    const existing = generationEntries.get(key);
    if (existing) {
      return existing;
    }
    const entry = createRuntimeEntry(serverId, config, snapshot.generationId);
    generationEntries.set(key, entry);
    return entry;
  }

  async function listHealth(snapshot?: McpGenerationSnapshot): Promise<McpServerHealth[]> {
    if (snapshot) {
      return Object.keys(snapshot.config.mcpServers)
        .map((serverId) => getGenerationEntry(snapshot, serverId))
        .filter((entry): entry is RuntimeEntry => entry !== undefined)
        .map(toHealth)
        .sort((left, right) => left.serverId.localeCompare(right.serverId));
    }
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

  async function handleUnexpectedExit(entry: RuntimeEntry, reason: string): Promise<void> {
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

    const shouldRestart = entry.config.restartOnCrash === true && !entry.crashRestartUsed;
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
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
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

    const startToken = {};
    const startOperation = (async () => {
      const startingFingerprint = entry.configFingerprint;
      const isCurrentStart = (): boolean =>
        entry.configFingerprint === startingFingerprint && entry.startToken === startToken;
      try {
        // Create an internal abort controller so we can abort the connection
        // when the connect timeout fires. Without this, a hanging MCP server
        // (one that never responds to initialize) would leave the connection
        // promise pending forever, orphaning the spawned child process.
        const connectAbort = new AbortController();
        const abortConnect = (): void => connectAbort.abort();
        // Also propagate external signal abortion.
        signal?.addEventListener('abort', abortConnect, { once: true });

        const connectionPromise = connectMcpStdio(entry.serverId, entry.config, {
          signal: connectAbort.signal,
        });
        const client = await withTimeout(
          connectionPromise,
          connectTimeoutMs,
          `MCP connect timeout for ${entry.serverId}`,
          () => {
            // Abort the connection — this causes connectMcpStdio to reject,
            // which triggers cleanup (transport.close + SIGKILL) in the
            // client implementation.
            abortConnect();
            void connectionPromise.then(
              (lateClient) => closeWithDeadline(lateClient),
              () => undefined,
            );
          },
          signal,
        );
        if (disposed || entry.intentionalStop || entry.configFingerprint !== startingFingerprint) {
          await closeWithDeadline(client);
          return;
        }
        entry.client = client;
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
        if (isCurrentStart()) {
          clearRuntimeFields(entry);
          entry.status = 'error';
          entry.lastError = error instanceof Error ? error.message : String(error);
        }
        throw error;
      } finally {
        if (entry.startToken === startToken) {
          delete entry.startPromise;
          delete entry.startToken;
        }
      }
    })();
    entry.startPromise = startOperation;
    entry.startToken = startToken;
    await startOperation;
  }

  async function start(serverId: string, signal?: AbortSignal): Promise<McpServerHealth> {
    throwIfAborted(signal);
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
      await startInternal(entry, { resetCrashBudget: true }, signal);
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
    return ensureConnected(serverId);
  }

  async function ensureConnected(
    serverId: string,
    signal?: AbortSignal,
  ): Promise<McpTransportClient> {
    throwIfAborted(signal);
    const health = await start(serverId, signal);
    throwIfAborted(signal);
    const entry = entries.get(serverId);
    if (!entry?.client || health.status !== 'running') {
      throw new Error(
        health.lastError ?? `MCP server ${serverId} is not running (${health.status})`,
      );
    }
    return entry.client;
  }

  async function ensureConnectedForSnapshot(
    snapshot: McpGenerationSnapshot,
    serverId: string,
    signal?: AbortSignal,
  ): Promise<{ client: McpTransportClient; entry: RuntimeEntry }> {
    throwIfAborted(signal);
    if (!snapshot.enabledServerIds.includes(serverId)) {
      throw new Error(`MCP server ${serverId} is not enabled in the generation snapshot`);
    }
    const entry = getGenerationEntry(snapshot, serverId);
    if (!entry || entry.config.disabled === true) {
      throw new Error(`MCP server ${serverId} is not enabled in the generation snapshot`);
    }
    await startInternal(entry, { resetCrashBudget: true }, signal);
    throwIfAborted(signal);
    if (!entry.client || entry.status !== 'running') {
      throw new Error(entry.lastError ?? `MCP server ${serverId} is not running (${entry.status})`);
    }
    return { client: entry.client, entry };
  }

  function getClient(serverId: string): McpTransportClient | null {
    return entries.get(serverId)?.client ?? null;
  }

  async function listTools(
    serverId: string,
    signal?: AbortSignal,
    snapshot?: McpGenerationSnapshot,
  ): Promise<McpToolSummary[]> {
    return discoverTools(serverId, signal, snapshot);
  }

  async function discoverTools(
    serverId: string,
    signal?: AbortSignal,
    snapshot?: McpGenerationSnapshot,
  ): Promise<McpToolSummary[]> {
    throwIfAborted(signal);
    let entry: RuntimeEntry | undefined;
    if (snapshot) {
      entry = getGenerationEntry(snapshot, serverId);
      if (!entry || !snapshot.enabledServerIds.includes(serverId)) {
        throw new Error(`MCP server ${serverId} is not enabled in the generation snapshot`);
      }
    } else {
      await refreshConfig();
      entry = entries.get(serverId);
      if (!entry) {
        throw new Error(`unknown MCP server: ${serverId}`);
      }
      if (entry.config.disabled) {
        return [];
      }
    }
    if (entry.discoverPromise) {
      return entry.discoverPromise;
    }

    const discoverPromise = (async () => {
      const { client } = snapshot
        ? await ensureConnectedForSnapshot(snapshot, serverId, signal)
        : { client: await ensureConnected(serverId, signal) };
      throwIfAborted(signal);
      const listed = await withTimeout(
        client.listTools(signal),
        listToolsTimeoutMs,
        `MCP tools/list timeout for ${serverId}`,
        () => discardClientAfterFailure(entry, client, 'tools/list timeout'),
        signal,
      );
      entry.toolCount = listed.length;
      await metadataCatalog.replaceServerMetadata(serverId, entry.config, listed);
      return listed.map((tool) =>
        toMcpToolSummary(serverId, tool.name, tool.description ?? '', tool.inputSchema),
      );
    })().finally(() => {
      delete entry.discoverPromise;
    });

    entry.discoverPromise = discoverPromise;
    return discoverPromise;
  }

  async function callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    snapshot?: McpGenerationSnapshot,
  ): Promise<unknown> {
    throwIfAborted(signal);
    const connected = snapshot
      ? await ensureConnectedForSnapshot(snapshot, serverId, signal)
      : { client: await ensureConnected(serverId, signal), entry: entries.get(serverId) };
    const { client, entry } = connected;
    if (!entry) {
      throw new Error(`unknown MCP server: ${serverId}`);
    }
    throwIfAborted(signal);
    return withTimeout(
      client.callTool(toolName, args, signal),
      callTimeoutMs,
      `MCP tool call timeout for ${serverId}/${toolName}`,
      () => discardClientAfterFailure(entry, client, 'tool call timeout'),
      signal,
    );
  }

  async function releaseGenerationSnapshot(generationId: string): Promise<void> {
    const ownedEntries = [...generationEntries.entries()].filter(
      ([, entry]) => entry.generationId === generationId,
    );
    await Promise.all(
      ownedEntries.map(async ([key, entry]) => {
        entry.intentionalStop = true;
        if (entry.client) {
          await safeClose(entry.client);
        }
        clearRuntimeFields(entry);
        entry.status = entry.config.disabled ? 'disabled' : 'stopped';
        generationEntries.delete(key);
      }),
    );
  }

  async function dispose(): Promise<void> {
    disposed = true;
    const allEntries = [...entries.values(), ...generationEntries.values()];
    await Promise.all(
      allEntries.map(async (entry) => {
        entry.intentionalStop = true;
        if (entry.client) {
          await safeClose(entry.client);
        }
        clearRuntimeFields(entry);
        entry.status = entry.config.disabled ? 'disabled' : 'stopped';
      }),
    );
    entries.clear();
    generationEntries.clear();
  }

  return {
    refreshConfig,
    listHealth,
    start,
    stop,
    ensureConnected,
    ensureStarted,
    getClient,
    listTools,
    discoverTools,
    callTool,
    releaseGenerationSnapshot,
    getMetadataCatalog: () => metadataCatalog,
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('MCP operation aborted');
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abortHandler = (): void => {
      onTimeout?.();
      clearTimeout(timer);
      reject(new Error('MCP operation aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
    if (signal?.aborted) {
      abortHandler();
      return;
    }
    signal?.addEventListener('abort', abortHandler, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortHandler);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortHandler);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function discardClientAfterFailure(
  entry: RuntimeEntry,
  client: McpTransportClient,
  reason: string,
): void {
  if (entry.client !== client) {
    return;
  }
  if (entry.exitUnsubscribe) {
    entry.exitUnsubscribe();
    delete entry.exitUnsubscribe;
  }
  entry.client = null;
  entry.toolCount = 0;
  delete entry.pid;
  delete entry.startedAt;
  entry.status = 'error';
  entry.lastError = reason;
  void closeWithDeadline(client);
}

async function closeWithDeadline(client: McpTransportClient, timeoutMs = 8_000): Promise<void> {
  await Promise.race([
    safeClose(client),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs).unref();
    }),
  ]);
}
