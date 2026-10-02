/**
 * Bridge-backed `SessionHandle` for one installed Agent plugin session (ADR 0082).
 *
 * The Host owns Runs, permissions, media import and transcript projection;
 * this handle only translates them onto the plugin frame protocol. Emissions
 * are applied in arrival order, and generated media is imported before its
 * event is delivered, so a Run never observes a half-imported turn.
 */
import {
  abortedAgentPromptOutcome,
  type AgentEvent,
  type AgentMessageView,
  type AgentPluginMediaProposal,
  type AgentPluginOpenedSession,
  type AgentPluginPermissionDecision,
  type AgentPluginPermissionPrompt,
  type AgentPluginSessionScope,
  type AgentPromptOutcome,
  type BackendRunIntervention,
  type BackendRunInterventionEvent,
  type BackendWorkflowSnapshot,
  type BackendRunInterventionEventResult,
  type ExternalAgentMcpServerStatus,
  type PromptInput,
  type SessionBackendBinding,
  type SessionBackendOptions,
  type SessionBackendCapabilities,
  type SessionHandle,
  type SessionTreeView,
  type SavedMediaAsset,
} from '@piwin/contracts';
import { AgentPluginBridge } from './agent-plugin-bridge.js';
import { importAgentPluginEventMedia } from './agent-plugin-media.js';
import { AgentPluginTurnTiming } from './agent-plugin-turn-timing.js';

const CANCEL_GRACE_MS = 3_000;

export type AgentPluginSessionPorts = {
  /** Bridged onto the Host pending-permission map; never an OS prompt. */
  requestPermission: (prompt: AgentPluginPermissionPrompt) => Promise<AgentPluginPermissionDecision>;
  onOptionsChanged?: (options: SessionBackendOptions) => void;
  onTitle?: (title: string) => void;
  onMcpStatus?: (servers: readonly ExternalAgentMcpServerStatus[], observed: boolean) => void;
  onTransportClosed?: (reason: string) => void;
  /** Import a declared generated-media file. Runs before the event is delivered. */
  importMedia?: (proposal: AgentPluginMediaProposal) => Promise<SavedMediaAsset | undefined>;
  /** Host projection (transcript presentation) applied before delivery. */
  prepareEvent?: (event: AgentEvent) => Promise<AgentEvent>;
  getCurrentRunId?: () => string | undefined;
  /** Test seam: replace how the child process is started. */
  startBridge?: typeof AgentPluginBridge.start;
};

export type AgentPluginSessionOpenOptions = {
  /** Absolute path to the installed, digest-verified `agent.mjs`. */
  entrypoint: string;
  agentId: string;
  pluginRevision: string;
  runtime: { binaryPath?: string };
  cwd: string;
  binding: SessionBackendBinding;
  /** `new` creates, `load` replays history, `resume` continues without replay. */
  mode: 'new' | 'load' | 'resume';
  scope: AgentPluginSessionScope;
  ports: AgentPluginSessionPorts;
  env?: NodeJS.ProcessEnv;
  nodePath?: string;
  requestTimeoutMs?: number;
};

export class AgentPluginSession implements SessionHandle {
  readonly id: string;
  readonly backendAgentId: string;

  private readonly bridge: AgentPluginBridge;
  private readonly ports: AgentPluginSessionPorts;
  private readonly openScope: AgentPluginSessionScope;
  private readonly openCwd: string;
  private readonly openBinding: SessionBackendBinding;
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly interventionListeners = new Set<
    (event: BackendRunInterventionEvent) => Promise<BackendRunInterventionEventResult>
  >();
  private deliveryChain: Promise<void> = Promise.resolve();
  private backendSessionId = '';
  private currentOptions: SessionBackendOptions;
  private released = false;
  private userCancelled = false;
  private promptActive = false;
  private readonly turnTiming = new AgentPluginTurnTiming();
  private mcpServers: ExternalAgentMcpServerStatus[] = [];
  private mcpObserved = false;
  private readonly capabilities: SessionBackendCapabilities | undefined;

  private constructor(
    options: AgentPluginSessionOpenOptions,
    bridge: AgentPluginBridge,
    opened: AgentPluginOpenedSession,
  ) {
    this.id = options.scope.sessionId;
    this.backendAgentId = options.agentId;
    this.openScope = options.scope;
    this.openCwd = options.cwd;
    this.openBinding = options.binding;
    this.ports = options.ports;
    this.bridge = bridge;
    this.backendSessionId = opened.backendSessionId;
    this.currentOptions = opened.options;
    this.capabilities = opened.capabilities;
  }

  /** Adapter-declared capabilities; `undefined` before the session was activated. */
  getCapabilities(): SessionBackendCapabilities | undefined {
    return this.capabilities;
  }

  /** Workflow snapshots the adapter projects from its own files. */
  async listWorkflows(): Promise<BackendWorkflowSnapshot[]> {
    if (this.released) return [];
    return await this.bridge.request(
      'session/workflows',
      { cwd: this.openCwd, binding: this.openBinding },
      this.scope(),
    );
  }

  async readWorkflowReport(workflowId: string): Promise<string | undefined> {
    if (this.released) return undefined;
    const result = await this.bridge.request(
      'session/workflow-report',
      { cwd: this.openCwd, binding: this.openBinding, workflowId },
      this.scope(),
    );
    return result.text;
  }

  getMcpStatuses(): { servers: ExternalAgentMcpServerStatus[]; observed: boolean } {
    return { servers: [...this.mcpServers], observed: this.mcpObserved };
  }

  static async open(options: AgentPluginSessionOpenOptions): Promise<{ session: AgentPluginSession; opened: AgentPluginOpenedSession }> {
    const start = options.ports.startBridge ?? AgentPluginBridge.start;
    let session: AgentPluginSession | undefined;
    const bridge = start({
      entrypoint: options.entrypoint,
      agentId: options.agentId,
      pluginRevision: options.pluginRevision,
      runtime: options.runtime,
      resolveSessionScope: (scope) =>
        scope.sessionId === options.scope.sessionId &&
        scope.runtimeGenerationId === options.scope.runtimeGenerationId,
      onSessionEmission: (emission) => session?.enqueue(emission),
      callbacks: {
        requestPermission: (prompt) => options.ports.requestPermission(prompt),
        interventionEvent: (event) => session?.emitIntervention(event) ?? Promise.resolve({ accepted: false }),
      },
      onClosed: (reason) => options.ports.onTransportClosed?.(reason),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.nodePath !== undefined ? { nodePath: options.nodePath } : {}),
      ...(options.requestTimeoutMs !== undefined ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
    });
    const scope = { kind: 'session' as const, ...options.scope };
    try {
      await bridge.initialize();
      const method = options.mode === 'new' ? 'session/new' : options.mode === 'load' ? 'session/load' : 'session/resume';
      const opened = await bridge.request(method, { cwd: options.cwd, binding: options.binding }, scope);
      const created = new AgentPluginSession(options, bridge, opened);
      session = created;
      return { session: created, opened };
    } catch (error) {
      await bridge.dispose().catch(() => undefined);
      throw error;
    }
  }

  get sessionId(): string {
    return this.backendSessionId;
  }

  getBackendOptions(): SessionBackendOptions {
    return this.currentOptions;
  }

  async setModel(modelId: string): Promise<void> {
    this.applyOptions(await this.bridge.request('session/model', { modelId }, this.scope()));
  }

  async setEffort(effortId: string): Promise<void> {
    this.applyOptions(await this.bridge.request('session/effort', { effortId }, this.scope()));
  }

  async setMode(modeId: string): Promise<void> {
    this.applyOptions(await this.bridge.request('session/mode', { modeId }, this.scope()));
  }

  async prompt(input: PromptInput): Promise<AgentPromptOutcome> {
    if (this.released) throw new Error('agent-plugin-session-released');
    this.userCancelled = false;
    this.promptActive = true;
    const runId = this.ports.getCurrentRunId?.() ?? 'run-unknown';
    this.turnTiming.begin(runId);
    try {
      return await this.bridge.prompt(this.openScope, {
        input,
        runId,
      });
    } catch (error) {
      // A cancel or release that killed the turn is an abort, not a failure.
      if (this.userCancelled || this.released) return abortedAgentPromptOutcome();
      throw error;
    } finally {
      await this.flush();
      this.turnTiming.end();
      this.promptActive = false;
    }
  }

  async abort(): Promise<void> {
    if (!this.promptActive) return;
    this.userCancelled = true;
    try {
      await this.bridge.request('session/cancel', {}, this.scope());
    } catch {
      // The prompt rejection is the authority; cancel is best-effort.
    }
    const settled = await waitForCondition(() => !this.promptActive, CANCEL_GRACE_MS);
    if (!settled) {
      this.ports.onTransportClosed?.('agent-plugin-cancel-timeout');
      await this.release();
    }
  }

  steer(): Promise<void> {
    return Promise.reject(new Error('steer-unsupported: external agent sessions use run interventions'));
  }

  followUp(): Promise<void> {
    return Promise.reject(new Error('follow-up-unsupported: external agent sessions use queued turns'));
  }

  async armRunIntervention(intervention: BackendRunIntervention): Promise<void> {
    if (!this.promptActive) throw new Error('run-intervention-no-active-turn');
    await this.bridge.request('session/interject', intervention, this.scope());
  }

  async cancelRunIntervention(interventionId: string, expectedRevision: number): Promise<boolean> {
    return this.bridge.request('session/interject-cancel', { interventionId, expectedRevision }, this.scope());
  }

  subscribeRunInterventions(
    listener: (event: BackendRunInterventionEvent) => Promise<BackendRunInterventionEventResult>,
  ): () => void {
    this.interventionListeners.add(listener);
    return () => {
      this.interventionListeners.delete(listener);
    };
  }

  async getMessages(): Promise<AgentMessageView[]> {
    return [];
  }

  async getTree(): Promise<SessionTreeView> {
    return { root: null, activeLeafId: null };
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  needsProductHistoryInjection(): boolean {
    return false;
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    this.bridge.markDisposed();
    this.listeners.clear();
    await this.bridge.dispose().catch(() => undefined);
  }

  /** Wait for every queued emission to be imported, projected and delivered. */
  async flush(): Promise<void> {
    await this.deliveryChain;
  }

  private scope() {
    return { kind: 'session' as const, ...this.openScope };
  }

  private applyOptions(options: SessionBackendOptions): void {
    this.currentOptions = options;
    this.ports.onOptionsChanged?.(options);
  }

  private enqueue(emission: AgentPluginEmissionLike): void {
    if (this.released) return;
    if (emission.type === 'options') {
      this.applyOptions(emission.options);
      return;
    }
    if (emission.type === 'title') {
      this.ports.onTitle?.(emission.title);
      return;
    }
    if (emission.type === 'mcp-status') {
      this.mcpServers = [...emission.servers];
      this.mcpObserved = emission.observed;
      this.ports.onMcpStatus?.(emission.servers, emission.observed);
      return;
    }
    if (emission.type === 'closed') {
      this.ports.onTransportClosed?.(emission.reason);
      return;
    }
    const timedEvent = this.turnTiming.observe(emission.event);
    this.deliveryChain = this.deliveryChain.then(async () => {
      if (this.released) return;
      const importedEvent = this.ports.importMedia === undefined
        ? timedEvent
        : await importAgentPluginEventMedia(timedEvent, emission.media ?? [], this.ports.importMedia);
      try {
        const event = this.ports.prepareEvent !== undefined
          ? await this.ports.prepareEvent(importedEvent)
          : importedEvent;
        if (this.released || this.userCancelled) return;
        for (const listener of this.listeners) listener(event);
      } catch {
        // Projection failure must not stop the ordered stream or crash the Run.
      }
    });
  }

  private async emitIntervention(event: BackendRunInterventionEvent): Promise<BackendRunInterventionEventResult> {
    let accepted = false;
    for (const listener of this.interventionListeners) {
      accepted = (await listener(event)).accepted || accepted;
    }
    return { accepted };
  }
}

type AgentPluginEmissionLike =
  | { type: 'agent'; event: AgentEvent; media?: readonly AgentPluginMediaProposal[] }
  | { type: 'options'; options: SessionBackendOptions }
  | { type: 'title'; title: string }
  | { type: 'mcp-status'; servers: readonly ExternalAgentMcpServerStatus[]; observed: boolean }
  | { type: 'closed'; reason: string };

async function waitForCondition(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}
