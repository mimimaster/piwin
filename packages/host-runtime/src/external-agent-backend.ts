/**
 * Host-side coordinator for every external agent backend (ADR 0082).
 *
 * One instance serves all installed adapters: readiness and the vendor session
 * catalog come from a plugin-scope control client, session work from a
 * per-session `AgentPluginSession`. Nothing here is aware of a specific vendor
 * beyond the agent id a session record already carries.
 */
import type {
  AgentEvent,
  AgentPluginMediaProposal,
  AgentPluginOutputDirectory,
  AgentPluginPermissionDecision,
  AgentPluginPermissionPrompt,
  BackendPermissionOption,
  ExternalAgentMcpServerStatus,
  ExternalAgentStatus,
  HostPush,
  PermissionDecision,
  PermissionRequestContext,
  SessionBackendBinding,
  SessionBackendCapabilities,
  SessionBackendOptions,
  SavedMediaAsset,
} from '@piwin/contracts';
import { AgentPluginControlClient } from './agent-plugin-control.js';
import { AgentPluginSession } from './agent-plugin-session.js';
import { importAgentPluginEventMedia, importAgentPluginMedia } from './agent-plugin-media.js';

/** Pending permission entry shape shared with HostRuntime (`pendingPermissions`). */
export type ExternalPendingPermission = {
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

/** The installed, enabled adapter a session runs on. */
export type ExternalAgentInstall = {
  agentId: string;
  /** Absolute path to the digest-verified `agent.mjs`. */
  entrypoint: string;
  revision: string;
  runtime: { binaryPath?: string };
  outputDirectories: readonly AgentPluginOutputDirectory[];
};

export type ExternalAgentBackendDeps = {
  push: (message: HostPush) => void;
  pendingPermissions: Map<string, ExternalPendingPermission>;
  getForegroundRunId: (sessionId: string) => string | undefined;
  /** The adapter reported a new title for a product session. */
  onSessionTitle: (sessionId: string, title: string) => void;
  /** A resident adapter process exited on its own. */
  onSessionTransportClosed: (sessionId: string, reason: string) => void;
  /** Resolves the installed + enabled adapter for an agent id. */
  requireInstall: (agentId: string) => Promise<ExternalAgentInstall>;
  createRequestId: () => string;
  /** Product data root; media imports must land in the Host's own vault. */
  piwinRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Test seam: replace how a control client is built. */
  startControl?: typeof AgentPluginControlClient.create;
};

export type OpenedExternalSession = {
  handle: AgentPluginSession;
  backendSessionId: string;
  agentVersion?: string;
  capabilities: SessionBackendCapabilities;
  /** Media for replay emissions is imported before this resolves. */
  replayEvents: AgentEvent[];
};

export class ExternalAgentBackend {
  private readonly deps: ExternalAgentBackendDeps;
  private readonly controls = new Map<string, AgentPluginControlClient>();
  private readonly handles = new Map<string, AgentPluginSession>();
  private readonly sessionOptions = new Map<string, SessionBackendOptions>();
  private readonly sessionCapabilities = new Map<string, SessionBackendCapabilities>();
  private readonly mcpStatuses = new Map<string, { agentId: string; servers: ExternalAgentMcpServerStatus[]; observed: boolean }>();

  constructor(deps: ExternalAgentBackendDeps) {
    this.deps = deps;
  }

  /**
   * MCP servers observed by one adapter, or by one session, or the union of
   * every resident session. Adapters report them per session; the command
   * surface asks per agent.
   */
  getMcpStatuses(filter?: { agentId?: string; sessionId?: string }): {
    servers: ExternalAgentMcpServerStatus[];
    observed: boolean;
  } {
    if (filter?.sessionId !== undefined) {
      const own = this.mcpStatuses.get(filter.sessionId);
      return own !== undefined ? { servers: [...own.servers], observed: own.observed } : { servers: [], observed: false };
    }
    const merged = new Map<string, ExternalAgentMcpServerStatus>();
    let observed = false;
    for (const entry of this.mcpStatuses.values()) {
      if (filter?.agentId !== undefined && entry.agentId !== filter.agentId) continue;
      observed = observed || entry.observed;
      for (const server of entry.servers) merged.set(server.name, server);
    }
    return { servers: [...merged.values()], observed };
  }

  peekStatus(agentId: string): ExternalAgentStatus | undefined {
    return this.controls.get(agentId)?.peekStatus();
  }

  invalidateStatus(agentId?: string): void {
    if (agentId !== undefined) {
      this.controls.get(agentId)?.invalidateStatus();
      return;
    }
    for (const control of this.controls.values()) control.invalidateStatus();
  }

  async getStatus(agentId: string, refresh = false): Promise<ExternalAgentStatus> {
    return await (await this.control(agentId)).getStatus(refresh);
  }

  /** The adapter's binary path, or a message explaining why it cannot run yet. */
  async requireReadyBinary(agentId: string): Promise<string> {
    const status = await this.getStatus(agentId, true);
    if (status.state === 'ready' || status.state === 'unauthenticated') return status.binaryPath;
    if (status.state === 'not-installed') {
      throw new Error(`${agentId}-not-installed: the agent CLI was not found`);
    }
    throw new Error(`${agentId}-unavailable: ${status.state === 'unavailable' ? status.reason : 'unknown state'}`);
  }

  getSessionOptions(sessionId: string): SessionBackendOptions | undefined {
    return this.sessionOptions.get(sessionId);
  }

  /** Adapter-declared capabilities; `undefined` until the session was activated. */
  getSessionCapabilities(sessionId: string): SessionBackendCapabilities | undefined {
    return this.sessionCapabilities.get(sessionId);
  }

  getBackendCapabilities(sessionId: string): SessionBackendCapabilities | undefined {
    return this.sessionCapabilities.get(sessionId);
  }

  forgetSession(sessionId: string): void {
    this.handles.delete(sessionId);
    this.sessionOptions.delete(sessionId);
    this.sessionCapabilities.delete(sessionId);
    this.mcpStatuses.delete(sessionId);
  }

  async listCatalog(agentId: string): Promise<Awaited<ReturnType<AgentPluginControlClient['listCatalog']>>> {
    return await (await this.control(agentId)).listCatalog();
  }

  async renameCatalogSession(agentId: string, backendSessionId: string, title: string): Promise<void> {
    await (await this.control(agentId)).renameCatalogSession(backendSessionId, title);
  }

  async deleteCatalogSession(agentId: string, backendSessionId: string): Promise<void> {
    await (await this.control(agentId)).deleteCatalogSession(backendSessionId);
  }

  async openSession(input: {
    agentId: string;
    productSessionId: string;
    cwd: string;
    binding: SessionBackendBinding;
    mode: 'new' | 'load' | 'resume';
    runtimeGenerationId: string;
    runId?: string;
  }): Promise<OpenedExternalSession> {
    const install = await this.deps.requireInstall(input.agentId);
    let session: AgentPluginSession | undefined;
    const mediaContext = (): Parameters<typeof importAgentPluginMedia>[0]['context'] => ({
      agentId: input.agentId,
      sessionId: input.productSessionId,
      backendSessionId: session?.sessionId ?? input.binding.backendSessionId ?? '',
      cwd: input.cwd,
      outputDirectories: install.outputDirectories,
    });
    const importMedia = async (proposal: AgentPluginMediaProposal): Promise<SavedMediaAsset | undefined> => {
      return await importAgentPluginMedia({
        proposal,
        context: mediaContext(),
        push: this.deps.push,
        ...(this.deps.piwinRoot !== undefined ? { piwinRoot: this.deps.piwinRoot } : {}),
      });
    };
    const opened = await AgentPluginSession.open({
      entrypoint: install.entrypoint,
      agentId: input.agentId,
      pluginRevision: install.revision,
      runtime: install.runtime,
      cwd: input.cwd,
      binding: input.binding,
      mode: input.mode,
      scope: { sessionId: input.productSessionId, runtimeGenerationId: input.runtimeGenerationId },
      ports: {
        requestPermission: (prompt) => this.requestPermission({
          agentId: input.agentId,
          sessionId: input.productSessionId,
          prompt,
        }),
        onOptionsChanged: (options) => this.sessionOptions.set(input.productSessionId, options),
        onTitle: (title) => this.deps.onSessionTitle(input.productSessionId, title),
        onMcpStatus: (servers, observed) => {
          this.mcpStatuses.set(input.productSessionId, { agentId: input.agentId, servers: [...servers], observed });
        },
        onTransportClosed: (reason) => this.deps.onSessionTransportClosed(input.productSessionId, reason),
        importMedia,
        getCurrentRunId: () => this.deps.getForegroundRunId(input.productSessionId),
      },
      ...(this.deps.env !== undefined ? { env: this.deps.env } : {}),
    });
    session = opened.session;
    this.handles.set(input.productSessionId, session);
    this.sessionOptions.set(input.productSessionId, opened.opened.options);
    this.sessionCapabilities.set(input.productSessionId, opened.opened.capabilities);
    const replayEvents: AgentEvent[] = [];
    for (const emission of opened.opened.replayEvents) {
      // Replay must arrive with its media already in the vault, in order.
      replayEvents.push(await importAgentPluginEventMedia(emission.event, emission.media ?? [], importMedia));
    }
    return {
      handle: session,
      backendSessionId: opened.opened.backendSessionId,
      ...(opened.opened.agentVersion !== undefined ? { agentVersion: opened.opened.agentVersion } : {}),
      capabilities: opened.opened.capabilities,
      replayEvents,
    };
  }

  async dispose(): Promise<void> {
    const controls = [...this.controls.values()];
    this.controls.clear();
    this.handles.clear();
    this.sessionOptions.clear();
    this.sessionCapabilities.clear();
    this.mcpStatuses.clear();
    await Promise.allSettled(controls.map(async (control) => await control.dispose()));
  }

  private async control(agentId: string): Promise<AgentPluginControlClient> {
    const existing = this.controls.get(agentId);
    if (existing !== undefined) return existing;
    const install = await this.deps.requireInstall(agentId);
    const create = this.deps.startControl ?? AgentPluginControlClient.create;
    const control = create({
      entrypoint: install.entrypoint,
      agentId,
      pluginRevision: install.revision,
      runtime: install.runtime,
      onStatusChanged: (status) => {
        this.deps.push({ type: 'agents/status-updated', status });
      },
      ...(this.deps.env !== undefined ? { env: this.deps.env } : {}),
    });
    this.controls.set(agentId, control);
    return control;
  }

  private requestPermission(input: {
    agentId: string;
    sessionId: string;
    prompt: AgentPluginPermissionPrompt;
  }): Promise<AgentPluginPermissionDecision> {
    const requestId = this.deps.createRequestId();
    const runId = input.prompt.runId ?? this.deps.getForegroundRunId(input.sessionId);
    const { prompt } = input;
    return new Promise((resolve) => {
      let settled = false;
      const pending: ExternalPendingPermission = {
        sessionId: input.sessionId,
        ...(runId !== undefined ? { runId } : {}),
        action: prompt.action,
        detail: prompt.detail,
        defaultDecision: 'ask',
        context: prompt.context,
        resolve: (decision) => {
          if (settled) return;
          settled = true;
          this.deps.pendingPermissions.delete(requestId);
          const chosen = pending.backendOptionId;
          this.pushResolved(input.sessionId, requestId, decision, runId);
          resolve(chosen !== undefined ? { optionId: chosen } : fallbackDecision(prompt.options, decision));
        },
      };
      this.deps.pendingPermissions.set(requestId, pending);
      const base = {
        requestId,
        action: prompt.action,
        detail: prompt.detail,
        defaultDecision: 'ask' as const,
        context: prompt.context,
        ...(runId !== undefined ? { runId } : {}),
      };
      this.deps.push({ type: 'permission/request', sessionId: input.sessionId, ...base });
      this.deps.push({
        type: 'event',
        sessionId: input.sessionId,
        event: { type: 'permission/request', ...base },
      });
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
 * Validate a client-supplied backend option id against the prompt the adapter
 * asked about. Returning a code refuses `permission/resolve`.
 */
export function validateBackendOption(
  pending: ExternalPendingPermission,
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

/**
 * Settle without an explicit option (legacy client, Stop, supersede): deny
 * maps to the first reject option, allow to the first allow option.
 */
export function fallbackDecision(
  options: readonly BackendPermissionOption[],
  decision: PermissionDecision,
): AgentPluginPermissionDecision {
  const wanted = decision === 'allow' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
  const option = options.find((candidate) => wanted.includes(candidate.kind));
  return option !== undefined ? { optionId: option.optionId } : { cancelled: true };
}
