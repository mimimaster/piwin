/**
 * Plugin-scope control plane for one installed Agent plugin (ADR 0082).
 *
 * Owns the short-lived adapter process used for `check` and the vendor
 * session catalog. It holds no session state: session work goes through
 * `AgentPluginSession`, which owns its own process and scope.
 *
 * A dying control process must never wedge the Host, so a failed call drops
 * the bridge and the next call respawns it.
 */
import {
  formatError,
  type AgentPluginCatalogEntry,
  type AgentPluginRequestUsageQuery,
  type ExternalAgentStatus,
  type ExternalAgentSupportStatus,
} from '@piwin/contracts';
import { AgentPluginBridge, AgentPluginBridgeError } from './agent-plugin-bridge.js';

const DEFAULT_STATUS_TTL_MS = 60_000;

export type AgentPluginControlOptions = {
  /** Absolute path to the installed, digest-verified `agent.mjs`. */
  entrypoint: string;
  agentId: string;
  pluginRevision: string;
  runtime: { binaryPath?: string };
  /** Fired when the readiness state changes, for `agents/status-updated`. */
  onStatusChanged?: (status: ExternalAgentStatus) => void;
  env?: NodeJS.ProcessEnv;
  nodePath?: string;
  requestTimeoutMs?: number;
  statusTtlMs?: number;
};

export class AgentPluginControlClient {
  private readonly options: AgentPluginControlOptions;
  private bridge: AgentPluginBridge | undefined;
  private bridgePromise: Promise<AgentPluginBridge> | undefined;
  private status: ExternalAgentStatus | undefined;
  private statusAt = 0;
  private statusEpoch = 0;
  private statusPromise: Promise<ExternalAgentStatus> | undefined;
  private disposed = false;

  private constructor(options: AgentPluginControlOptions) {
    this.options = options;
  }

  static create(options: AgentPluginControlOptions): AgentPluginControlClient {
    return new AgentPluginControlClient(options);
  }

  peekStatus(): ExternalAgentStatus | undefined {
    return this.status;
  }

  get revision(): string {
    return this.options.pluginRevision;
  }

  /** Forces the next `getStatus` to hand-shake again (enable/disable, runtime path change). */
  invalidateStatus(): void {
    this.statusEpoch += 1;
    this.status = undefined;
    this.statusAt = 0;
    this.statusPromise = undefined;
  }

  async getStatus(refresh = false): Promise<ExternalAgentStatus> {
    const ttl = this.options.statusTtlMs ?? DEFAULT_STATUS_TTL_MS;
    if (!refresh && this.status !== undefined && Date.now() - this.statusAt < ttl) {
      return this.status;
    }
    if (this.statusPromise !== undefined) {
      return this.statusPromise;
    }
    const epoch = this.statusEpoch;
    const pending = this.check();
    this.statusPromise = pending;
    try {
      const next = await pending;
      // A concurrent enable/disable invalidated this answer while it flew.
      if (epoch !== this.statusEpoch) {
        throw new Error('agent-readiness-changed: retry the check');
      }
      const previous = this.status;
      this.status = next;
      this.statusAt = Date.now();
      if (previous === undefined || previous.state !== next.state) {
        this.options.onStatusChanged?.(next);
      }
      return next;
    } finally {
      if (epoch === this.statusEpoch) this.statusPromise = undefined;
    }
  }

  /** Full vendor catalog, including sessions created outside piwin. */
  async listCatalog(): Promise<AgentPluginCatalogEntry[]> {
    const entries = await this.call('catalog/list', {});
    if (!Array.isArray(entries)) throw new AgentPluginBridgeError('backend-error', 'catalog/list returned a non-array');
    return entries;
  }

  async renameCatalogSession(backendSessionId: string, title: string): Promise<void> {
    await this.call('catalog/rename', { backendSessionId, title });
  }

  /** Optional data-only query; old adapters retain their finalized-turn fallback. */
  async listRequestUsage(query: AgentPluginRequestUsageQuery): Promise<unknown> {
    // Older frame parsers reject unknown methods before they can return "unsupported".
    if (!(await this.ensureBridge()).supportsRequestUsage) return [];
    try {
      return await this.call('catalog/usage', query);
    } catch (error) {
      if (error instanceof AgentPluginBridgeError && (error.code === 'unsupported' || error.code === 'unavailable')) {
        return [];
      }
      throw error;
    }
  }

  async deleteCatalogSession(backendSessionId: string): Promise<void> {
    await this.call('catalog/delete', { backendSessionId });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const bridge = this.bridge;
    this.bridge = undefined;
    this.bridgePromise = undefined;
    if (bridge !== undefined) await bridge.dispose().catch(() => undefined);
  }

  private async check(): Promise<ExternalAgentStatus> {
    try {
      const parsed = parseExternalAgentStatus(await this.call('check', { refresh: true }), this.options.agentId);
      if (parsed !== undefined) return parsed;
      return this.unavailable('agent-plugin-invalid-status: the adapter reported no usable status');
    } catch (error) {
      return this.unavailable(formatError(error));
    }
  }

  private unavailable(reason: string): ExternalAgentStatus {
    return {
      agentId: this.options.agentId,
      state: 'unavailable',
      binaryPath: this.options.runtime.binaryPath ?? '',
      reason,
      checkedAt: new Date().toISOString(),
    };
  }

  private async call<Method extends 'check' | 'catalog/list' | 'catalog/usage' | 'catalog/rename' | 'catalog/delete'>(
    method: Method,
    params: unknown,
  ): Promise<unknown> {
    if (this.disposed) throw new AgentPluginBridgeError('plugin-closed', 'control client is disposed');
    const bridge = await this.ensureBridge();
    try {
      return await bridge.request(method, params as never, { kind: 'plugin' });
    } catch (error) {
      // Only a dead process invalidates the bridge; a plugin-level refusal stands.
      if (error instanceof AgentPluginBridgeError &&
          (error.code === 'plugin-exited' || error.code === 'plugin-closed' || error.code === 'plugin-timeout')) {
        this.dropBridge(bridge);
      }
      throw error;
    }
  }

  private async ensureBridge(): Promise<AgentPluginBridge> {
    if (this.bridge !== undefined && !this.bridge.closed) return this.bridge;
    if (this.bridgePromise !== undefined) return this.bridgePromise;
    const bridge = AgentPluginBridge.start({
      entrypoint: this.options.entrypoint,
      agentId: this.options.agentId,
      pluginRevision: this.options.pluginRevision,
      runtime: this.options.runtime,
      // A control process serves plugin-scope methods only; session frames are refused.
      resolveSessionScope: () => false,
      onSessionEmission: () => undefined,
      callbacks: {
        requestPermission: async () => ({ cancelled: true }),
        interventionEvent: async () => ({ accepted: false }),
      },
      onClosed: () => this.dropBridge(bridge),
      ...(this.options.env !== undefined ? { env: this.options.env } : {}),
      ...(this.options.nodePath !== undefined ? { nodePath: this.options.nodePath } : {}),
      ...(this.options.requestTimeoutMs !== undefined ? { requestTimeoutMs: this.options.requestTimeoutMs } : {}),
    });
    this.bridge = bridge;
    const pending = bridge.initialize().then(
      () => bridge,
      (error: unknown) => {
        this.dropBridge(bridge);
        throw error;
      },
    );
    this.bridgePromise = pending;
    try {
      return await pending;
    } finally {
      if (this.bridgePromise === pending) this.bridgePromise = undefined;
    }
  }

  private dropBridge(bridge: AgentPluginBridge): void {
    if (this.bridge === bridge) this.bridge = undefined;
    if (this.bridgePromise !== undefined) this.bridgePromise = undefined;
    void bridge.dispose().catch(() => undefined);
  }
}

const SUPPORT_STATUSES: readonly ExternalAgentSupportStatus[] = ['verified', 'unverified'];

/**
 * A reviewed adapter is still a separate process: its status payload is
 * decoded, never trusted, and a wrong shape becomes `unavailable`.
 */
export function parseExternalAgentStatus(value: unknown, agentId: string): ExternalAgentStatus | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const status = value as Record<string, unknown>;
  if (status.agentId !== agentId || typeof status.state !== 'string') return undefined;
  const checkedAt = typeof status.checkedAt === 'string' && Number.isFinite(Date.parse(status.checkedAt))
    ? status.checkedAt
    : new Date().toISOString();
  if (status.state === 'ready' || status.state === 'unauthenticated') {
    const supportStatus = SUPPORT_STATUSES.find((candidate) => candidate === status.supportStatus);
    if (typeof status.binaryPath !== 'string' || typeof status.version !== 'string' || supportStatus === undefined) {
      return undefined;
    }
    return {
      agentId,
      state: status.state,
      binaryPath: status.binaryPath,
      version: status.version,
      supportStatus,
      checkedAt,
      ...(typeof status.defaultAuthMethodId === 'string' ? { defaultAuthMethodId: status.defaultAuthMethodId } : {}),
      ...(typeof status.permissionMode === 'string' ? { permissionMode: status.permissionMode } : {}),
      ...(typeof status.options === 'object' && status.options !== null
        ? { options: status.options as NonNullable<Extract<ExternalAgentStatus, { state: 'ready' }>['options']> }
        : {}),
    };
  }
  if (status.state === 'not-installed') {
    if (!Array.isArray(status.searched) || !status.searched.every((entry) => typeof entry === 'string')) return undefined;
    return { agentId, state: 'not-installed', searched: status.searched, checkedAt };
  }
  if (status.state === 'unavailable') {
    if (typeof status.binaryPath !== 'string' || typeof status.reason !== 'string') return undefined;
    return { agentId, state: 'unavailable', binaryPath: status.binaryPath, reason: status.reason, checkedAt };
  }
  return undefined;
}
