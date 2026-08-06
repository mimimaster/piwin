/**
 * Host-owned MCP supervisor.
 *
 * One entry owns one transport handle at a time. A handle is registered before
 * readiness is awaited, and every replacement/timeout/dispose path awaits the
 * same handle's close operation. This is the invariant that prevents the old
 * "late connect" process leak.
 */
import type {
  McpConfigApplyReport,
  McpConfigDocument,
  McpServerConfig,
  McpServerHealth,
  McpServerRuntimeStatus,
  McpToolSummary,
} from '@piwin/contracts';
import {
  createEmptyMcpConfig,
  loadMcpConfig,
  validateMcpConfig,
} from './mcp-config.js';
import { spawnMcpStdio } from './mcp-client.js';
import type { McpOwnedProcess, McpTransportClient } from './mcp-transport.js';
import { toMcpToolSummary } from './tool-names.js';
import { fingerprintMcpServerConfig } from './mcp-fingerprint.js';
import { createMcpMetadataCatalog, type McpMetadataCatalog } from './mcp-metadata-catalog.js';
import type { McpGenerationSnapshot } from './mcp-generation-snapshot.js';

const CRASH_RESTART_BACKOFF_MS = 500;
const DEFAULT_CONNECT_TIMEOUT_MS = 12_000;
const DEFAULT_LIST_TOOLS_TIMEOUT_MS = 10_000;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const DEFAULT_FAILURE_COOLDOWN_MS = 5_000;
const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 8_000;

export class McpSupervisorClosedError extends Error {
  public constructor() {
    super('MCP supervisor is closing');
    this.name = 'McpSupervisorClosedError';
  }
}

export type McpLifecycleManagerOptions = {
  connectTimeoutMs?: number;
  listToolsTimeoutMs?: number;
  callTimeoutMs?: number;
  failureCooldownMs?: number;
  drainTimeoutMs?: number;
  /** Diagnostic threshold only; close never abandons an owned process. */
  closeTimeoutMs?: number;
};

type RuntimeEntry = {
  serverId: string;
  config: McpServerConfig;
  configFingerprint: string;
  revision: number;
  status: McpServerRuntimeStatus;
  client: McpTransportClient | null;
  ownedProcess: McpOwnedProcess | null;
  toolCount: number;
  lastError?: string;
  startedAt?: string;
  pid?: number;
  unhealthyUntil?: number;
  startPromise?: Promise<void>;
  startToken?: object;
  connectAbort?: AbortController;
  discoverPromise?: Promise<McpToolSummary[]>;
  /** True while stop/apply/dispose intentionally closes the owner. */
  intentionalStop: boolean;
  /** Whether the single crash-restart budget has been used for this run. */
  crashRestartUsed: boolean;
  /** Calls which passed the drain gate and are still using the client. */
  activeCalls: number;
  acceptingCalls: boolean;
  exitUnsubscribe?: () => void;
};

export type McpLifecycleManager = {
  refreshConfig: () => Promise<McpConfigDocument>;
  /** Apply an already validated document without rereading disk. */
  applyConfig: (config: McpConfigDocument) => Promise<McpConfigApplyReport>;
  getConfig: () => McpConfigDocument;
  listHealth: (snapshot?: McpGenerationSnapshot) => Promise<McpServerHealth[]>;
  start: (serverId: string, signal?: AbortSignal) => Promise<McpServerHealth>;
  stop: (serverId: string) => Promise<McpServerHealth>;
  restart: (serverId: string, signal?: AbortSignal) => Promise<McpServerHealth>;
  /** Connect + initialize only (no tools/list). */
  ensureConnected: (serverId: string, signal?: AbortSignal) => Promise<McpTransportClient>;
  /** @deprecated Prefer ensureConnected — kept for compatibility. */
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

/** Alias used by the architecture document; kept alongside the old public name. */
export type McpSupervisor = McpLifecycleManager;

export function createMcpLifecycleManager(
  piwinRoot: string,
  options: McpLifecycleManagerOptions = {},
): McpLifecycleManager {
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const listToolsTimeoutMs = options.listToolsTimeoutMs ?? DEFAULT_LIST_TOOLS_TIMEOUT_MS;
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const failureCooldownMs = options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS;
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
  const entries = new Map<string, RuntimeEntry>();
  const metadataCatalog = createMcpMetadataCatalog(piwinRoot);
  let document: McpConfigDocument = createEmptyMcpConfig();
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let configOperationTail: Promise<void> = Promise.resolve();

  function throwIfDisposed(): void {
    if (disposed) {
      throw new McpSupervisorClosedError();
    }
  }

  async function withConfigLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = configOperationTail;
    let release: () => void = () => undefined;
    configOperationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  function createRuntimeEntry(
    serverId: string,
    config: McpServerConfig,
  ): RuntimeEntry {
    return {
      serverId,
      config,
      configFingerprint: fingerprintMcpServerConfig(serverId, config),
      revision: 0,
      status: config.disabled === true ? 'disabled' : 'stopped',
      client: null,
      ownedProcess: null,
      toolCount: 0,
      intentionalStop: false,
      crashRestartUsed: false,
      activeCalls: 0,
      acceptingCalls: config.disabled !== true,
    };
  }

  function clearRuntimeFields(entry: RuntimeEntry): void {
    if (entry.exitUnsubscribe) {
      entry.exitUnsubscribe();
      delete entry.exitUnsubscribe;
    }
    entry.client = null;
    entry.ownedProcess = null;
    entry.toolCount = 0;
    delete entry.pid;
    delete entry.startedAt;
    delete entry.startPromise;
    delete entry.startToken;
    delete entry.connectAbort;
    delete entry.discoverPromise;
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
    if (entry.unhealthyUntil !== undefined && entry.unhealthyUntil > Date.now()) {
      health.unhealthyUntil = new Date(entry.unhealthyUntil).toISOString();
    }
    return health;
  }

  function isCoolingDown(entry: RuntimeEntry): boolean {
    if (entry.unhealthyUntil === undefined) {
      return false;
    }
    if (entry.unhealthyUntil <= Date.now()) {
      delete entry.unhealthyUntil;
      return false;
    }
    return true;
  }

  function getEntryForSnapshot(
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
    // The snapshot is an exposure/allowlist snapshot only. Process ownership
    // always belongs to the one mutable Supervisor entry for this server.
    return entries.get(serverId);
  }

  async function closeEntryOwner(entry: RuntimeEntry): Promise<void> {
    const ownedProcess = entry.ownedProcess;
    const client = entry.client;
    if (!ownedProcess && !client) {
      return;
    }
    const startedAt = Date.now();
    if (ownedProcess) {
      await safeCloseOwnedProcess(ownedProcess);
    } else {
      await safeClose(client);
    }
    if (Date.now() - startedAt > closeTimeoutMs) {
      console.warn(
        `[piwin/mcp] close exceeded ${closeTimeoutMs}ms for ${entry.serverId}; ` +
          'the owner completed its bounded shutdown sequence',
      );
    }
  }

  async function drainAndClose(entry: RuntimeEntry, reason: string): Promise<void> {
    entry.revision += 1;
    entry.acceptingCalls = false;
    entry.intentionalStop = true;
    entry.status = 'stopping';
    entry.connectAbort?.abort();
    const startPromise = entry.startPromise;

    const deadline = Date.now() + drainTimeoutMs;
    while (entry.activeCalls > 0 && Date.now() < deadline) {
      await delay(10);
    }

    await closeEntryOwner(entry);
    if (startPromise) {
      await ignoreRejection(startPromise);
    }
    clearRuntimeFields(entry);
    if (reason === 'dispose') {
      delete entry.lastError;
    }
  }

  async function applyConfigInternal(nextConfig: McpConfigDocument): Promise<McpConfigApplyReport> {
    throwIfDisposed();
    const normalized = validateMcpConfig(nextConfig);
    const currentPins = document.pinnedSelectors ?? [];
    const nextPins = normalized.pinnedSelectors ?? [];
    const exposureChanged = !sameStringArray(currentPins, nextPins);
    const allServerIds = new Set([
      ...Object.keys(document.mcpServers),
      ...Object.keys(normalized.mcpServers),
    ]);
    const changedServerIds: string[] = [];
    const transitions: Promise<void>[] = [];

    for (const serverId of allServerIds) {
      const nextServer = normalized.mcpServers[serverId];
      const existing = entries.get(serverId);
      if (!existing) {
        if (nextServer) {
          changedServerIds.push(serverId);
        }
        continue;
      }
      if (!nextServer) {
        changedServerIds.push(serverId);
        transitions.push(drainAndClose(existing, 'server removed from config'));
        continue;
      }
      const nextFingerprint = fingerprintMcpServerConfig(serverId, nextServer);
      if (existing.configFingerprint !== nextFingerprint) {
        changedServerIds.push(serverId);
        transitions.push(drainAndClose(existing, 'server configuration changed'));
      }
    }

    await Promise.all(transitions);
    for (const serverId of allServerIds) {
      const nextServer = normalized.mcpServers[serverId];
      const existing = entries.get(serverId);
      if (!nextServer) {
        await metadataCatalog.markServerStale(serverId);
        entries.delete(serverId);
        continue;
      }
      if (!existing) {
        entries.set(serverId, createRuntimeEntry(serverId, nextServer));
        continue;
      }
      const nextFingerprint = fingerprintMcpServerConfig(serverId, nextServer);
      const changed = existing.configFingerprint !== nextFingerprint;
      if (changed) {
        existing.config = nextServer;
        existing.configFingerprint = nextFingerprint;
        existing.acceptingCalls = nextServer.disabled !== true;
        existing.status = nextServer.disabled === true ? 'disabled' : 'stopped';
        existing.intentionalStop = false;
        existing.crashRestartUsed = false;
        delete existing.unhealthyUntil;
        delete existing.lastError;
        delete existing.discoverPromise;
        await metadataCatalog.markServerStale(serverId);
      } else if (nextServer.disabled === true) {
        existing.config = nextServer;
        existing.configFingerprint = nextFingerprint;
        existing.acceptingCalls = false;
        existing.status = 'disabled';
      } else if (existing.status === 'disabled') {
        existing.config = nextServer;
        existing.configFingerprint = nextFingerprint;
        existing.acceptingCalls = true;
        existing.status = 'stopped';
        existing.intentionalStop = false;
      } else {
        existing.config = nextServer;
        existing.configFingerprint = nextFingerprint;
      }
    }
    document = normalized;
    return {
      changedServerIds: changedServerIds.sort((left, right) => left.localeCompare(right)),
      exposureChanged,
      warnings: [],
    };
  }

  async function refreshConfig(): Promise<McpConfigDocument> {
    return withConfigLock(async () => {
      throwIfDisposed();
      const nextConfig = await loadMcpConfig(piwinRoot);
      await applyConfigInternal(nextConfig);
      return document;
    });
  }

  async function applyConfig(config: McpConfigDocument): Promise<McpConfigApplyReport> {
    return withConfigLock(async () => applyConfigInternal(config));
  }

  function getConfig(): McpConfigDocument {
    return document;
  }

  async function listHealth(snapshot?: McpGenerationSnapshot): Promise<McpServerHealth[]> {
    throwIfDisposed();
    if (snapshot) {
      await refreshConfig();
      return Object.keys(snapshot.config.mcpServers)
        .map((serverId) => getEntryForSnapshot(snapshot, serverId))
        .filter((entry): entry is RuntimeEntry => entry !== undefined)
        .map((entry) => toHealth(entry))
        .sort((left, right) => left.serverId.localeCompare(right.serverId));
    }
    await refreshConfig();
    return [...entries.values()]
      .map((entry) => toHealth(entry))
      .sort((left, right) => left.serverId.localeCompare(right.serverId));
  }

  function wireExitWatchdog(entry: RuntimeEntry, client: McpTransportClient): void {
    entry.exitUnsubscribe?.();
    const revision = entry.revision;
    entry.exitUnsubscribe = client.onExit((reason) => {
      if (
        disposed ||
        entry.intentionalStop ||
        entry.revision !== revision ||
        entry.client !== client
      ) {
        return;
      }
      // Exit is emitted by the transport event boundary; keep the watchdog
      // asynchronous so the transport's close event is never blocked.
      void handleUnexpectedExit(entry, client, reason);
    });
  }

  async function handleUnexpectedExit(
    entry: RuntimeEntry,
    client: McpTransportClient,
    reason: string,
  ): Promise<void> {
    if (disposed || entry.intentionalStop || entry.client !== client) {
      return;
    }
    const incidentRevision = entry.revision;
    const ownedProcess = entry.ownedProcess;
    entry.revision += 1;
    entry.intentionalStop = true;
    entry.acceptingCalls = false;
    entry.exitUnsubscribe?.();
    delete entry.exitUnsubscribe;
    await (ownedProcess ? safeCloseOwnedProcess(ownedProcess) : safeClose(client));

    const isCurrent =
      entry.revision === incidentRevision + 1 &&
      entry.client === client &&
      entry.ownedProcess === ownedProcess;
    if (!isCurrent) {
      return;
    }
    entry.client = null;
    entry.ownedProcess = null;
    entry.toolCount = 0;
    delete entry.pid;
    delete entry.startedAt;
    entry.status = 'error';
    entry.lastError = reason;
    entry.unhealthyUntil = Date.now() + failureCooldownMs;
    entry.intentionalStop = false;

    const shouldRestart = entry.config.restartOnCrash === true && !entry.crashRestartUsed;
    if (!shouldRestart) {
      return;
    }

    entry.crashRestartUsed = true;
    entry.status = 'starting';
    entry.lastError = `${reason}; restarting once…`;
    const restartRevision = entry.revision;
    await delay(CRASH_RESTART_BACKOFF_MS);
    if (
      disposed ||
      entry.intentionalStop ||
      entry.status !== 'starting' ||
      entry.revision !== restartRevision ||
      entry.client !== null ||
      entry.ownedProcess !== null
    ) {
      return;
    }
    try {
      await startInternal(entry, { resetCrashBudget: false, bypassCooldown: true });
    } catch (error) {
      entry.status = 'error';
      entry.acceptingCalls = false;
      entry.lastError =
        error instanceof Error
          ? `restart after crash failed: ${error.message}`
          : `restart after crash failed: ${String(error)}`;
      entry.unhealthyUntil = Date.now() + failureCooldownMs;
    }
  }

  async function startInternal(
    entry: RuntimeEntry,
    startOptions: { resetCrashBudget: boolean; bypassCooldown: boolean },
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    if (entry.status === 'running' && entry.client) {
      return;
    }
    if (entry.startPromise) {
      await waitForAbortable(entry.startPromise, signal);
      return;
    }
    if (entry.status === 'stopping' || entry.intentionalStop) {
      throw new Error(`MCP server ${entry.serverId} is restarting`);
    }
    if (entry.config.disabled === true) {
      entry.status = 'disabled';
      throw new Error(`MCP server ${entry.serverId} is disabled`);
    }
    if (!startOptions.bypassCooldown && isCoolingDown(entry)) {
      throw new Error(
        `MCP server ${entry.serverId} is unhealthy; retry after the cooldown expires`,
      );
    }

    entry.status = 'starting';
    entry.acceptingCalls = false;
    entry.intentionalStop = false;
    if (startOptions.resetCrashBudget) {
      entry.crashRestartUsed = false;
      delete entry.unhealthyUntil;
    }
    delete entry.lastError;

    const startToken = {};
    const startingRevision = entry.revision;
    const connectAbort = new AbortController();
    const abortConnect = (): void => connectAbort.abort();
    signal?.addEventListener('abort', abortConnect, { once: true });
    entry.startToken = startToken;
    entry.connectAbort = connectAbort;

    const startOperation = (async (): Promise<void> => {
      let ownedProcess: McpOwnedProcess | null = null;
      try {
        // This is the ownership hand-off. spawnMcpStdio returns the process
        // handle before readiness, so every later path can close this exact
        // process even if initialize never responds.
        ownedProcess = spawnMcpStdio(entry.serverId, entry.config, {
          signal: connectAbort.signal,
        });
        entry.ownedProcess = ownedProcess;
        const client = await withTimeout(
          ownedProcess.ready,
          connectTimeoutMs,
          `MCP connect timeout for ${entry.serverId}`,
          () => connectAbort.abort(),
          signal,
        );
        const isCurrent =
          entry.startToken === startToken &&
          entry.revision === startingRevision &&
          !entry.intentionalStop &&
          !disposed;
        if (!isCurrent) {
          await safeCloseOwnedProcess(ownedProcess);
          return;
        }
        entry.client = client;
        entry.status = 'running';
        entry.acceptingCalls = true;
        entry.startedAt = new Date().toISOString();
        if (ownedProcess.pid !== undefined) {
          entry.pid = ownedProcess.pid;
        } else if (client.pid !== undefined) {
          entry.pid = client.pid;
        } else {
          delete entry.pid;
        }
        delete entry.lastError;
        delete entry.unhealthyUntil;
        wireExitWatchdog(entry, client);
      } catch (error) {
        if (ownedProcess) {
          await safeCloseOwnedProcess(ownedProcess);
        }
        const isCurrent = entry.startToken === startToken && entry.revision === startingRevision;
        if (isCurrent) {
          entry.client = null;
          entry.ownedProcess = null;
          entry.acceptingCalls = false;
          entry.status = 'error';
          entry.lastError = error instanceof Error ? error.message : String(error);
          if (!isAbortError(error)) {
            entry.unhealthyUntil = Date.now() + failureCooldownMs;
          }
        }
        throw error;
      } finally {
        signal?.removeEventListener('abort', abortConnect);
        if (entry.startToken === startToken) {
          delete entry.startToken;
          delete entry.startPromise;
          delete entry.connectAbort;
        }
      }
    })();
    entry.startPromise = startOperation;
    await startOperation;
  }

  async function start(serverId: string, signal?: AbortSignal): Promise<McpServerHealth> {
    throwIfAborted(signal);
    await refreshConfig();
    const entry = entries.get(serverId);
    if (!entry) {
      throw new Error(`unknown MCP server: ${serverId}`);
    }
    if (entry.config.disabled === true) {
      entry.status = 'disabled';
      return toHealth(entry);
    }
    try {
      await startInternal(entry, { resetCrashBudget: true, bypassCooldown: true }, signal);
    } catch {
      // The health record is the public result for an explicit start request.
    }
    return toHealth(entry);
  }

  async function stop(serverId: string): Promise<McpServerHealth> {
    await refreshConfig();
    const entry = entries.get(serverId);
    if (!entry) {
      throw new Error(`unknown MCP server: ${serverId}`);
    }
    await drainAndClose(entry, 'stopped by user');
    entry.crashRestartUsed = false;
    entry.acceptingCalls = entry.config.disabled !== true;
    entry.status = entry.config.disabled === true ? 'disabled' : 'stopped';
    entry.intentionalStop = false;
    delete entry.unhealthyUntil;
    return toHealth(entry);
  }

  async function restart(serverId: string, signal?: AbortSignal): Promise<McpServerHealth> {
    await stop(serverId);
    return start(serverId, signal);
  }

  async function ensureStarted(serverId: string): Promise<McpTransportClient> {
    return ensureConnected(serverId);
  }

  async function ensureConnected(
    serverId: string,
    signal?: AbortSignal,
  ): Promise<McpTransportClient> {
    throwIfAborted(signal);
    await refreshConfig();
    const entry = entries.get(serverId);
    if (!entry) {
      throw new Error(`unknown MCP server: ${serverId}`);
    }
    if (entry.config.disabled === true) {
      throw new Error(`MCP server ${serverId} is disabled`);
    }
    if (!entry.client || entry.status !== 'running') {
      await startInternal(entry, { resetCrashBudget: false, bypassCooldown: false }, signal);
    }
    throwIfAborted(signal);
    if (!entry.client || entry.status !== 'running' || !entry.acceptingCalls) {
      throw new Error(entry.lastError ?? `MCP server ${serverId} is not running`);
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
    await refreshConfig();
    const entry = getEntryForSnapshot(snapshot, serverId);
    if (!entry || entry.config.disabled === true) {
      throw new Error(`MCP server ${serverId} is not enabled in the generation snapshot`);
    }
    if (!entry.client || entry.status !== 'running') {
      await startInternal(entry, { resetCrashBudget: false, bypassCooldown: false }, signal);
    }
    throwIfAborted(signal);
    if (!entry.client || entry.status !== 'running' || !entry.acceptingCalls) {
      throw new Error(entry.lastError ?? `MCP server ${serverId} is not running`);
    }
    return { client: entry.client, entry };
  }

  function getClient(serverId: string): McpTransportClient | null {
    return entries.get(serverId)?.client ?? null;
  }

  async function discoverTools(
    serverId: string,
    signal?: AbortSignal,
    snapshot?: McpGenerationSnapshot,
  ): Promise<McpToolSummary[]> {
    throwIfAborted(signal);
    let entry: RuntimeEntry | undefined;
    if (snapshot) {
      entry = getEntryForSnapshot(snapshot, serverId);
      if (!entry || !snapshot.enabledServerIds.includes(serverId)) {
        throw new Error(`MCP server ${serverId} is not enabled in the generation snapshot`);
      }
    } else {
      await refreshConfig();
      entry = entries.get(serverId);
      if (!entry) {
        throw new Error(`unknown MCP server: ${serverId}`);
      }
      if (entry.config.disabled === true) {
        return [];
      }
    }
    if (entry.discoverPromise) {
      return waitForAbortable(entry.discoverPromise, signal);
    }

    const discoverPromise = (async (): Promise<McpToolSummary[]> => {
      const connected = snapshot
        ? await ensureConnectedForSnapshot(snapshot, serverId, signal)
        : { client: await ensureConnected(serverId, signal), entry };
      const operationAbort = new AbortController();
      const relayAbort = (): void => operationAbort.abort();
      signal?.addEventListener('abort', relayAbort, { once: true });
      try {
        const listed = await withTimeout(
          connected.client.listTools(operationAbort.signal),
          listToolsTimeoutMs,
          `MCP tools/list timeout for ${serverId}`,
          () => operationAbort.abort(),
          signal,
        );
        connected.entry.toolCount = listed.length;
        await metadataCatalog.replaceServerMetadata(
          serverId,
          connected.entry.config,
          listed,
        );
        return listed.map((tool) =>
          toMcpToolSummary(serverId, tool.name, tool.description ?? '', tool.inputSchema),
        );
      } catch (error) {
        if (isAbortError(error) || isTimeoutError(error)) {
          await invalidateClient(connected.entry, connected.client, errorMessage(error));
        }
        throw error;
      } finally {
        signal?.removeEventListener('abort', relayAbort);
      }
    })().finally(() => {
      delete entry?.discoverPromise;
    });
    entry.discoverPromise = discoverPromise;
    return discoverPromise;
  }

  async function listTools(
    serverId: string,
    signal?: AbortSignal,
    snapshot?: McpGenerationSnapshot,
  ): Promise<McpToolSummary[]> {
    return discoverTools(serverId, signal, snapshot);
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
    const entry = connected.entry;
    if (!entry || entry.client !== connected.client || !entry.acceptingCalls) {
      throw new Error(`MCP server ${serverId} is restarting`);
    }
    // The check and increment are synchronous, so a config apply cannot begin
    // between the drain gate and the active-call count update.
    entry.activeCalls += 1;
    const operationAbort = new AbortController();
    const relayAbort = (): void => operationAbort.abort();
    signal?.addEventListener('abort', relayAbort, { once: true });
    try {
      return await withTimeout(
        connected.client.callTool(toolName, args, operationAbort.signal),
        callTimeoutMs,
        `MCP tool call timeout for ${serverId}/${toolName}`,
        () => operationAbort.abort(),
        signal,
      );
    } catch (error) {
      if (isAbortError(error) || isTimeoutError(error)) {
        await invalidateClient(entry, connected.client, errorMessage(error));
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', relayAbort);
      entry.activeCalls = Math.max(0, entry.activeCalls - 1);
    }
  }

  async function invalidateClient(
    entry: RuntimeEntry,
    client: McpTransportClient,
    reason: string,
  ): Promise<void> {
    if (entry.client !== client) {
      return;
    }
    entry.revision += 1;
    entry.acceptingCalls = false;
    entry.intentionalStop = true;
    entry.exitUnsubscribe?.();
    delete entry.exitUnsubscribe;
    entry.status = 'error';
    entry.lastError = reason;
    entry.unhealthyUntil = Date.now() + failureCooldownMs;
    await closeEntryOwner(entry);
    entry.client = null;
    entry.ownedProcess = null;
    entry.toolCount = 0;
    delete entry.pid;
    delete entry.startedAt;
    entry.intentionalStop = false;
  }

  async function releaseGenerationSnapshot(_generationId: string): Promise<void> {
    // Compatibility no-op: snapshots describe a session surface but never own
    // a transport. The Supervisor's server slots outlive individual sessions.
    return Promise.resolve();
  }

  async function dispose(): Promise<void> {
    if (disposePromise) {
      return disposePromise;
    }
    disposed = true;
    disposePromise = withConfigLock(async () => {
      const allEntries = [...entries.values()];
      await Promise.all(
        allEntries.map(async (entry) => {
          await drainAndClose(entry, 'dispose');
          entry.status = entry.config.disabled === true ? 'disabled' : 'stopped';
          entry.acceptingCalls = false;
        }),
      );
      entries.clear();
    });
    return disposePromise;
  }

  return {
    refreshConfig,
    applyConfig,
    getConfig,
    listHealth,
    start,
    stop,
    restart,
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

export const createMcpSupervisor = createMcpLifecycleManager;

async function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    throw new Error('MCP operation aborted');
  }
  return new Promise<T>((resolve, reject) => {
    const abortHandler = (): void => {
      signal.removeEventListener('abort', abortHandler);
      reject(new Error('MCP operation aborted'));
    };
    signal.addEventListener('abort', abortHandler, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abortHandler);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abortHandler);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout: () => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);
      onTimeout();
      reject(new Error(message));
    }, timeoutMs);
    const abortHandler = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortHandler);
      onTimeout();
      reject(new Error('MCP operation aborted'));
    };
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

async function safeCloseOwnedProcess(ownedProcess: McpOwnedProcess): Promise<void> {
  try {
    await ownedProcess.close();
  } catch {
    // The supervisor has already waited for the transport's close boundary.
  }
}

async function safeClose(client: McpTransportClient | null): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.close();
  } catch {
    // Cleanup is best effort; the process owner remains the primary boundary.
  }
}

async function ignoreRejection(promise: Promise<void>): Promise<void> {
  try {
    await promise;
  } catch {
    // The initiating operation already recorded the failure on its entry.
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('MCP operation aborted');
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('aborted');
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('timeout');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
