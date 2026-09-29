/**
 * Host-side Grok Build backend coordinator (ADR 0082).
 *
 * Owns CLI detection, per-session `GrokSessionHandle` creation, permission
 * bridging onto the Host pending-permission map, and the Grok session catalog
 * (list / rename / delete). HostRuntime consults it at routing seams; the Pi
 * `ProductAgentHost` never sees Grok sessions.
 */

import { homedir } from 'node:os';
import {
  AcpClient,
  GROK_DROPPED_NOTIFICATION_METHODS,
  JsonRpcConnection,
  projectGrokCatalogEntry,
  type AcpLineTransport,
  type GrokCatalogSession,
  type GrokPermissionPrompt,
} from '@piwin/acp-agent';
import type {
  AgentEvent,
  ExternalAgentStatus,
  HostPush,
  PermissionDecision,
  PermissionRequestContext,
  SessionBackendBinding,
  SessionBackendOptions,
} from '@piwin/contracts';
import { detectGrokCli } from './grok-cli-detection.js';
import { createGrokProcessTransport } from './grok-process-transport.js';
import { GROK_AGENT_ID } from './grok-capabilities.js';
import {
  GrokSessionHandle,
  type GrokOpenedSession,
  type GrokPermissionDecision,
} from './grok-session-handle.js';

const STATUS_TTL_MS = 60_000;
const CATALOG_TIMEOUT_MS = 20_000;

/** Pending permission entry shape shared with HostRuntime (`pendingPermissions`). */
export type GrokPendingPermission = {
  resolve: (decision: PermissionDecision) => void;
  sessionId: string;
  runId?: string;
  action: string;
  detail: string;
  defaultDecision?: PermissionDecision;
  context?: PermissionRequestContext;
  /** Backend option id chosen by `permission/resolve`, read by the resolver. */
  backendOptionId?: string;
  cleanup?: () => void;
};

export type GrokBackendServiceDeps = {
  push: (message: HostPush) => void;
  pendingPermissions: Map<string, GrokPendingPermission>;
  getForegroundRunId: (sessionId: string) => string | undefined;
  /** Grok reported a new title for a product session. */
  onSessionTitle: (sessionId: string, title: string) => void;
  /** A resident Grok process exited on its own. */
  onSessionTransportClosed: (sessionId: string, reason: string) => void;
  env?: NodeJS.ProcessEnv;
  /** Test seam: replace the process transport. */
  createTransport?: (binaryPath: string, cwd: string) => AcpLineTransport;
  /** Test seam: replace detection. */
  detect?: () => Promise<ExternalAgentStatus>;
  createRequestId: () => string;
};

export class GrokBackendService {
  private readonly deps: GrokBackendServiceDeps;
  private status: ExternalAgentStatus | undefined;
  private statusAt = 0;
  private statusPromise: Promise<ExternalAgentStatus> | undefined;
  private readonly sessionOptions = new Map<string, SessionBackendOptions>();

  constructor(deps: GrokBackendServiceDeps) {
    this.deps = deps;
  }

  /** Cached CLI status; `refresh` forces a new handshake. */
  async getStatus(refresh = false): Promise<ExternalAgentStatus> {
    if (!refresh && this.status !== undefined && Date.now() - this.statusAt < STATUS_TTL_MS) {
      return this.status;
    }
    if (this.statusPromise !== undefined) {
      return this.statusPromise;
    }
    const detect =
      this.deps.detect ??
      (() =>
        detectGrokCli({
          ...(this.deps.env !== undefined ? { env: this.deps.env } : {}),
          homeDir: homedir(),
          ...(this.deps.createTransport !== undefined
            ? {
                createTransport: (binaryPath: string) => {
                  const transport = this.deps.createTransport?.(binaryPath, process.cwd());
                  if (transport === undefined) {
                    throw new Error('grok transport factory returned nothing');
                  }
                  return transport;
                },
              }
            : {}),
        }));
    this.statusPromise = detect()
      .then((status) => {
        const previous = this.status;
        this.status = status;
        this.statusAt = Date.now();
        if (previous === undefined || previous.state !== status.state) {
          this.deps.push({ type: 'agents/status-updated', status });
        }
        return status;
      })
      .finally(() => {
        this.statusPromise = undefined;
      });
    return this.statusPromise;
  }

  /** Throws a user-facing error when Grok cannot run a session. */
  async requireReadyBinary(): Promise<string> {
    const status = await this.getStatus();
    switch (status.state) {
      case 'ready':
        return status.binaryPath;
      case 'unauthenticated':
        throw new Error('grok-unauthenticated: run `grok login` on the Host, then retry');
      case 'not-installed':
        throw new Error('grok-not-installed: install the Grok CLI on the Host');
      case 'unavailable':
        throw new Error(`grok-unavailable: ${status.reason}`);
    }
  }

  /** Open (new / resume / load) a live Grok session for a product session. */
  async openSession(input: {
    productSessionId: string;
    cwd: string;
    binding: SessionBackendBinding;
    replay: boolean;
  }): Promise<GrokOpenedSession> {
    const binaryPath = await this.requireReadyBinary();
    const opened = await GrokSessionHandle.open(
      {
        productSessionId: input.productSessionId,
        cwd: input.cwd,
        ...(input.binding.backendSessionId !== undefined
          ? { backendSessionId: input.binding.backendSessionId }
          : {}),
        replay: input.replay,
        ...(input.binding.modelId !== undefined ? { modelId: input.binding.modelId } : {}),
        ...(input.binding.effortId !== undefined ? { effortId: input.binding.effortId } : {}),
        ...(input.binding.modeId !== undefined ? { modeId: input.binding.modeId } : {}),
      },
      {
        createTransport: (cwd) => this.createTransport(binaryPath, cwd),
        requestPermission: (request) => this.requestPermission(request),
        onOptionsChanged: (options) => {
          this.sessionOptions.set(input.productSessionId, options);
          this.deps.push({
            type: 'session/backend-updated',
            sessionId: input.productSessionId,
            options,
          });
        },
        onTitle: (title) => this.deps.onSessionTitle(input.productSessionId, title),
        onTransportClosed: (reason) =>
          this.deps.onSessionTransportClosed(input.productSessionId, reason),
        getCurrentRunId: () => this.deps.getForegroundRunId(input.productSessionId),
      },
    );
    this.sessionOptions.set(input.productSessionId, opened.handle.getBackendOptions());
    return opened;
  }

  /** Last known options for a session (resident or not). */
  getSessionOptions(productSessionId: string): SessionBackendOptions | undefined {
    return this.sessionOptions.get(productSessionId) ?? this.defaultOptions();
  }

  forgetSession(productSessionId: string): void {
    this.sessionOptions.delete(productSessionId);
  }

  /** Full Grok session catalog (includes TUI-created sessions). */
  async listCatalog(): Promise<GrokCatalogSession[]> {
    return this.withCatalogClient(async (client) => {
      const entries = await client.xaiListSessions();
      return entries.map(projectGrokCatalogEntry);
    });
  }

  async renameCatalogSession(backendSessionId: string, title: string): Promise<void> {
    await this.withCatalogClient((client) => client.xaiRenameSession(backendSessionId, title));
  }

  async deleteCatalogSession(backendSessionId: string): Promise<void> {
    await this.withCatalogClient((client) => client.xaiDeleteSession(backendSessionId));
  }

  /**
   * Resolve a Grok permission request from `permission/resolve`. Returns an
   * error string when the option id is invalid for this request.
   */
  static validateBackendOption(
    pending: GrokPendingPermission,
    decision: PermissionDecision,
    backendOptionId: string | undefined,
  ): string | undefined {
    const options = pending.context?.backendOptions;
    if (options === undefined) {
      return backendOptionId === undefined ? undefined : 'backend-option-not-expected';
    }
    if (backendOptionId === undefined) {
      return 'backend-option-required';
    }
    const option = options.find((candidate) => candidate.optionId === backendOptionId);
    if (option === undefined) {
      return 'backend-option-unknown';
    }
    const allows = option.kind === 'allow_once' || option.kind === 'allow_always';
    if ((decision === 'allow') !== allows) {
      return 'backend-option-decision-mismatch';
    }
    return undefined;
  }

  private defaultOptions(): SessionBackendOptions | undefined {
    const status = this.status;
    return status !== undefined && (status.state === 'ready' || status.state === 'unauthenticated')
      ? status.options
      : undefined;
  }

  private createTransport(binaryPath: string, cwd: string): AcpLineTransport {
    if (this.deps.createTransport !== undefined) {
      return this.deps.createTransport(binaryPath, cwd);
    }
    return createGrokProcessTransport({
      binaryPath,
      cwd,
      ...(this.deps.env !== undefined ? { env: this.deps.env } : {}),
    });
  }

  private async withCatalogClient<T>(operation: (client: AcpClient) => Promise<T>): Promise<T> {
    const binaryPath = await this.requireReadyBinary();
    const connection = new JsonRpcConnection(this.createTransport(binaryPath, homedir()), {
      droppedNotificationMethods: GROK_DROPPED_NOTIFICATION_METHODS,
      defaultTimeoutMs: CATALOG_TIMEOUT_MS,
    });
    const client = new AcpClient(connection);
    try {
      await client.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'piwin', version: '0' },
      });
      return await operation(client);
    } finally {
      await connection.close();
    }
  }

  private requestPermission(input: {
    sessionId: string;
    prompt: GrokPermissionPrompt;
    signal: AbortSignal;
  }): Promise<GrokPermissionDecision> {
    const requestId = this.deps.createRequestId();
    const runId = this.deps.getForegroundRunId(input.sessionId);
    const { prompt } = input;
    return new Promise((resolve) => {
      let settled = false;
      const pending: GrokPendingPermission = {
        sessionId: input.sessionId,
        ...(runId !== undefined ? { runId } : {}),
        action: prompt.action,
        detail: prompt.detail,
        defaultDecision: 'ask',
        context: prompt.context,
        resolve: (decision) => {
          if (settled) {
            return;
          }
          settled = true;
          input.signal.removeEventListener('abort', onAbort);
          this.deps.pendingPermissions.delete(requestId);
          const chosen = pending.backendOptionId;
          this.pushResolved(input.sessionId, requestId, decision, runId);
          resolve(chosen !== undefined ? { optionId: chosen } : fallbackDecision(prompt, decision));
        },
      };
      const onAbort = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.deps.pendingPermissions.delete(requestId);
        this.pushResolved(input.sessionId, requestId, 'deny', runId);
        resolve({ cancelled: true });
      };
      pending.cleanup = () => input.signal.removeEventListener('abort', onAbort);
      this.deps.pendingPermissions.set(requestId, pending);
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener('abort', onAbort, { once: true });
      const base = {
        requestId,
        action: prompt.action,
        detail: prompt.detail,
        defaultDecision: 'ask' as const,
        context: prompt.context,
        ...(runId !== undefined ? { runId } : {}),
      };
      this.deps.push({ type: 'permission/request', sessionId: input.sessionId, ...base });
      const event: AgentEvent = { type: 'permission/request', ...base };
      this.deps.push({ type: 'event', sessionId: input.sessionId, event });
    });
  }

  private pushResolved(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
    runId: string | undefined,
  ): void {
    const run = runId !== undefined ? { runId } : {};
    this.deps.push({ type: 'permission/resolved', sessionId, requestId, decision, ...run });
    this.deps.push({
      type: 'event',
      sessionId,
      event: { type: 'permission/resolved', requestId, decision, ...run },
    });
  }
}

/**
 * Settle without an explicit option (legacy client, Stop, supersede): deny
 * maps to the first reject option, allow to the first allow-once option.
 */
function fallbackDecision(
  prompt: GrokPermissionPrompt,
  decision: PermissionDecision,
): GrokPermissionDecision {
  const wanted = decision === 'allow' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
  const option = prompt.options.find((candidate) => wanted.includes(candidate.kind));
  return option !== undefined ? { optionId: option.optionId } : { cancelled: true };
}

export { GROK_AGENT_ID };
