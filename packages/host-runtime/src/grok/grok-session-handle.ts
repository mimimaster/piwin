/**
 * Live Grok session handle (ADR 0082).
 *
 * One `grok agent stdio` process per resident product session. The handle
 * implements the product `SessionHandle` surface: prompt → ACP
 * `session/prompt`, abort → `session/cancel` (then process kill after a
 * bound), interventions → `_x.ai/interject`. Pi-only surfaces (steer/followUp
 * queues, tree, compaction) are refused explicitly rather than faked.
 * Notification routing lives in `grok-notification-router.ts`; result
 * mapping in `grok-prompt-outcome.ts`.
 */

import {
  AcpClient,
  GROK_DROPPED_NOTIFICATION_METHODS,
  GrokSessionOptionsState,
  JsonRpcConnection,
  parseGrokPermissionRequest,
  type AcpLineTransport,
  type AcpSessionSetupResult,
  type GrokPermissionPrompt,
} from '@piwin/acp-agent';
import type {
  AgentEvent,
  AgentMessageView,
  AgentPromptOutcome,
  BackendRunIntervention,
  BackendRunInterventionEvent,
  BackendRunInterventionEventResult,
  PromptInput,
  SessionBackendOptions,
  SessionHandle,
  SessionTreeView,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { GROK_AGENT_ID } from './grok-capabilities.js';
import { GrokNotificationRouter } from './grok-notification-router.js';
import {
  applyGrokInitialSelections,
  selectGrokEffort,
  selectGrokMode,
  selectGrokModel,
  type GrokSelectionTarget,
} from './grok-session-selection.js';
import {
  mapGrokPromptError,
  mapGrokPromptResult,
  toGrokContentBlocks,
  waitForCondition,
} from './grok-prompt-outcome.js';

const CANCEL_GRACE_MS = 5_000;
const SESSION_SETUP_TIMEOUT_MS = 60_000;

export type GrokPermissionDecision = { optionId: string } | { cancelled: true };

export type GrokSessionPorts = {
  /** Spawn a fresh transport for this session's cwd. */
  createTransport: (cwd: string) => AcpLineTransport;
  /** Ask the user; resolves with the chosen Grok option id. */
  requestPermission: (input: {
    sessionId: string;
    prompt: GrokPermissionPrompt;
    signal: AbortSignal;
  }) => Promise<GrokPermissionDecision>;
  /** Backend options changed (models, mode, commands). */
  onOptionsChanged: (options: SessionBackendOptions) => void;
  /** Grok reported a session title. */
  onTitle: (title: string) => void;
  /** Process ended unexpectedly while resident. */
  onTransportClosed: (reason: string) => void;
  /** Current foreground run id owned by the Host. */
  getCurrentRunId: () => string | undefined;
  now?: () => string;
};

export type GrokSessionOpenInput = {
  productSessionId: string;
  cwd: string;
  /** Existing Grok session to continue; absent creates a new one. */
  backendSessionId?: string;
  /** Replay history into the projector (first open / catalog drift). */
  replay?: boolean;
  modelId?: string;
  effortId?: string;
  modeId?: string;
};

export type GrokOpenedSession = {
  handle: GrokSessionHandle;
  backendSessionId: string;
  agentVersion?: string;
  /** Events produced by a `session/load` replay, in order. */
  replayEvents: AgentEvent[];
};

export class GrokSessionHandle implements SessionHandle {
  readonly id: string;
  readonly backendAgentId = GROK_AGENT_ID;
  backendSessionId: string;
  private readonly client: AcpClient;
  private readonly connection: JsonRpcConnection;
  private readonly ports: GrokSessionPorts;
  private readonly options = new GrokSessionOptionsState();
  private readonly notifications: GrokNotificationRouter;
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly interventionListeners = new Set<
    (event: BackendRunInterventionEvent) => Promise<BackendRunInterventionEventResult>
  >();
  private promptAbort: AbortController | undefined;
  private userCancelled = false;
  private permissionRejected = false;
  private released = false;

  private constructor(input: {
    productSessionId: string;
    client: AcpClient;
    connection: JsonRpcConnection;
    ports: GrokSessionPorts;
  }) {
    this.id = input.productSessionId;
    // Bound after session/new|load|resume; notifications before that are
    // accepted because one process serves exactly one session.
    this.backendSessionId = '';
    this.client = input.client;
    this.connection = input.connection;
    this.ports = input.ports;
    this.notifications = new GrokNotificationRouter(this.options, {
      emitAll: (events) => this.emitAll(events),
      onTitle: (title) => this.ports.onTitle(title),
      publishOptions: () => this.publishOptions(),
      ...(input.ports.now ? { now: input.ports.now } : {}),
    });
  }

  /** Spawn Grok, initialize, and create / resume / load the native session. */
  static async open(input: GrokSessionOpenInput, ports: GrokSessionPorts): Promise<GrokOpenedSession> {
    const connection = new JsonRpcConnection(ports.createTransport(input.cwd), {
      droppedNotificationMethods: GROK_DROPPED_NOTIFICATION_METHODS,
      defaultTimeoutMs: SESSION_SETUP_TIMEOUT_MS,
    });
    const client = new AcpClient(connection);
    try {
      const init = await client.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'piwin', version: '0' },
      });
      const agentVersion =
        typeof init._meta?.agentVersion === 'string' ? init._meta.agentVersion : undefined;
      // Replay notifications arrive before `session/load` returns, so the
      // handle must be listening before the request is sent.
      const handle = new GrokSessionHandle({ productSessionId: input.productSessionId, client, connection, ports });
      handle.attach();
      handle.options.applyModels(init._meta?.modelState);
      const replayEvents: AgentEvent[] = [];
      const mcpServers: unknown[] = [];
      let setup: AcpSessionSetupResult;
      if (input.backendSessionId === undefined) {
        setup = await client.newSession({ cwd: input.cwd, mcpServers });
      } else if (input.replay === true) {
        handle.notifications.beginReplay(replayEvents);
        try {
          setup = await client.loadSession({ sessionId: input.backendSessionId, cwd: input.cwd, mcpServers });
        } finally {
          handle.notifications.endReplay();
        }
      } else {
        setup = await client.resumeSession({ sessionId: input.backendSessionId, cwd: input.cwd, mcpServers });
      }
      handle.backendSessionId = setup.sessionId;
      handle.options.applyModels(setup.models);
      handle.options.applyConfigOptions(setup.configOptions);
      await applyGrokInitialSelections(handle.selectionTarget(), input);
      handle.publishOptions();
      return {
        handle,
        backendSessionId: setup.sessionId,
        ...(agentVersion !== undefined ? { agentVersion } : {}),
        replayEvents,
      };
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  /** Current backend option snapshot. */
  getBackendOptions(): SessionBackendOptions {
    return this.options.snapshot(GROK_AGENT_ID);
  }

  async setModel(modelId: string): Promise<void> {
    await selectGrokModel(this.selectionTarget(), modelId);
  }

  async setEffort(effortId: string): Promise<void> {
    await selectGrokEffort(this.selectionTarget(), effortId);
  }

  async setMode(modeId: string): Promise<void> {
    await selectGrokMode(this.selectionTarget(), modeId);
  }

  async prompt(input: PromptInput): Promise<AgentPromptOutcome> {
    if (this.released) {
      throw new Error('grok-session-released');
    }
    if (this.promptAbort !== undefined) {
      throw new Error('grok-prompt-active: Host admits one Grok prompt at a time');
    }
    const runId = this.ports.getCurrentRunId();
    const projector = this.notifications.beginTurn(runId);
    this.promptAbort = new AbortController();
    this.userCancelled = false;
    this.permissionRejected = false;
    try {
      const result = await this.client.prompt(
        { sessionId: this.backendSessionId, prompt: toGrokContentBlocks(input) },
        { signal: this.promptAbort.signal },
      );
      const mapped = mapGrokPromptResult(result, {
        productSessionId: this.id,
        runId,
        lastAssistantMessageId: projector.latestAssistantMessageId,
        userCancelled: this.userCancelled,
        permissionRejected: this.permissionRejected,
        recordedAt: this.now(),
      });
      this.emitAll(projector.finish(mapped.finish));
      if (mapped.usageEvent !== undefined) {
        this.emit(mapped.usageEvent);
      }
      return mapped.outcome;
    } catch (error) {
      this.emitAll(projector.finish(this.userCancelled ? 'aborted' : 'failed'));
      return mapGrokPromptError(error, {
        userCancelled: this.userCancelled,
        connectionClosed: this.connection.closed,
      });
    } finally {
      this.notifications.endTurn();
      this.promptAbort = undefined;
    }
  }

  async abort(): Promise<void> {
    const active = this.promptAbort;
    if (active === undefined) {
      return;
    }
    this.userCancelled = true;
    if (!this.connection.closed) {
      try {
        this.client.cancel(this.backendSessionId);
      } catch (error) {
        this.ports.onTransportClosed(`cancel failed: ${formatError(error)}`);
      }
    }
    // Grok answers `cancelled` in ~1s; past the grace window the process is
    // treated as wedged and killed so the Run can terminalize.
    const settled = await waitForCondition(() => this.promptAbort !== active, CANCEL_GRACE_MS);
    if (!settled) {
      active.abort(new Error('grok-cancel-timeout'));
      await this.release();
    }
  }

  steer(): Promise<void> {
    return Promise.reject(new Error('steer-unsupported: Grok sessions use run interventions'));
  }

  followUp(): Promise<void> {
    return Promise.reject(new Error('follow-up-unsupported: Grok sessions use queued turns'));
  }

  /** Interject text into the running turn; applies at Grok's next step. */
  async armRunIntervention(intervention: BackendRunIntervention): Promise<void> {
    if (this.promptAbort === undefined) {
      throw new Error('run-intervention-no-active-turn');
    }
    const base = {
      interventionId: intervention.interventionId,
      revision: intervention.revision,
      runId: intervention.runId,
      runtimeGenerationId: intervention.runtimeGenerationId,
    };
    const claimed = await this.emitIntervention({ type: 'claim', ...base });
    if (!claimed) {
      return;
    }
    try {
      await this.client.xaiInterject(this.backendSessionId, intervention.text);
      // Grok gives no applied acknowledgement; delivery is the strongest
      // truthful state (ADR 0082 §5).
      await this.emitIntervention({ type: 'applied', ...base });
    } catch (error) {
      await this.emitIntervention({ type: 'failed', ...base, reason: formatError(error) });
    }
  }

  async cancelRunIntervention(): Promise<boolean> {
    // Interjection is sent immediately at arm time; nothing stays staged.
    return false;
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
    if (this.released) {
      return;
    }
    this.released = true;
    await this.connection.close();
  }

  private attach(): void {
    this.connection.onNotification((method, params) => {
      this.notifications.handle(method, params, this.backendSessionId);
    });
    this.connection.setRequestHandler('session/request_permission', (params) =>
      this.handlePermissionRequest(params),
    );
    this.connection.onClose((info) => {
      if (!this.released) {
        this.released = true;
        this.ports.onTransportClosed(info.reason ?? `exit ${String(info.code)}`);
      }
    });
  }

  private selectionTarget(): GrokSelectionTarget {
    return {
      client: this.client,
      options: this.options,
      backendSessionId: () => this.backendSessionId,
      publishOptions: () => this.publishOptions(),
    };
  }

  private async handlePermissionRequest(params: unknown): Promise<unknown> {
    const prompt = parseGrokPermissionRequest(params, GROK_AGENT_ID);
    if (prompt === undefined) {
      return { outcome: { outcome: 'cancelled' } };
    }
    const signal = this.promptAbort?.signal ?? new AbortController().signal;
    const decision = await this.ports.requestPermission({ sessionId: this.id, prompt, signal });
    if ('cancelled' in decision) {
      return { outcome: { outcome: 'cancelled' } };
    }
    const chosen = prompt.options.find((option) => option.optionId === decision.optionId);
    if (chosen === undefined) {
      return { outcome: { outcome: 'cancelled' } };
    }
    if (chosen.kind === 'reject_once' || chosen.kind === 'reject_always') {
      this.permissionRejected = true;
    }
    return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
  }

  private async emitIntervention(event: BackendRunInterventionEvent): Promise<boolean> {
    let accepted = false;
    for (const listener of this.interventionListeners) {
      const result = await listener(event);
      accepted = accepted || result.accepted;
    }
    return accepted;
  }

  private publishOptions(): void {
    this.ports.onOptionsChanged(this.getBackendOptions());
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitAll(events: readonly AgentEvent[]): void {
    for (const event of events) {
      this.emit(event);
    }
  }

  private now(): string {
    return this.ports.now?.() ?? new Date().toISOString();
  }
}
