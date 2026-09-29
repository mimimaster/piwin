/**
 * Live Grok session handle (ADR 0082).
 *
 * One `grok agent stdio` process per resident product session. The handle
 * implements the product `SessionHandle` surface: prompt → ACP
 * `session/prompt`, abort → `session/cancel` (then process kill after a
 * bound), interventions → `_x.ai/interject`. Pi-only surfaces (steer/followUp
 * queues, tree, compaction) are refused explicitly rather than faked.
 */

import { randomUUID } from 'node:crypto';
import {
  AcpClient,
  classifyGrokStopReason,
  GROK_DROPPED_NOTIFICATION_METHODS,
  GrokSessionOptionsState,
  GrokTurnProjector,
  JsonRpcConnection,
  parseGrokPermissionRequest,
  parseGrokPromptUsage,
  type AcpContentBlock,
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
import { createUnknownAgentFailure, formatError } from '@piwin/contracts';
import { GROK_AGENT_ID } from './grok-capabilities.js';

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
  readonly backendSessionId: string;
  private readonly client: AcpClient;
  private readonly connection: JsonRpcConnection;
  private readonly ports: GrokSessionPorts;
  private readonly options = new GrokSessionOptionsState();
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly interventionListeners = new Set<
    (event: BackendRunInterventionEvent) => Promise<BackendRunInterventionEventResult>
  >();
  private projector: GrokTurnProjector | undefined;
  private replayBuffer: AgentEvent[] | undefined;
  private promptAbort: AbortController | undefined;
  private userCancelled = false;
  private permissionRejected = false;
  private released = false;

  private constructor(input: {
    productSessionId: string;
    backendSessionId: string;
    client: AcpClient;
    connection: JsonRpcConnection;
    ports: GrokSessionPorts;
  }) {
    this.id = input.productSessionId;
    this.backendSessionId = input.backendSessionId;
    this.client = input.client;
    this.connection = input.connection;
    this.ports = input.ports;
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
      const pending = new GrokSessionHandle({
        productSessionId: input.productSessionId,
        backendSessionId: input.backendSessionId ?? '',
        client,
        connection,
        ports,
      });
      pending.attach();
      pending.options.applyModels(init._meta?.modelState);
      const replayEvents: AgentEvent[] = [];
      let setup: AcpSessionSetupResult;
      const mcpServers: unknown[] = [];
      if (input.backendSessionId === undefined) {
        setup = await client.newSession({ cwd: input.cwd, mcpServers });
      } else if (input.replay === true) {
        pending.beginReplay(replayEvents);
        try {
          setup = await client.loadSession({ sessionId: input.backendSessionId, cwd: input.cwd, mcpServers });
        } finally {
          pending.endReplay();
        }
      } else {
        setup = await client.resumeSession({ sessionId: input.backendSessionId, cwd: input.cwd, mcpServers });
      }
      const handle =
        setup.sessionId === pending.backendSessionId
          ? pending
          : pending.rebind(setup.sessionId);
      handle.options.applyModels(setup.models);
      handle.options.applyConfigOptions(setup.configOptions);
      await handle.applyInitialSelections(input);
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
    if (!this.options.hasModel(modelId)) {
      throw new Error(`unknown-grok-model: ${modelId}`);
    }
    const result = await this.client.setConfigOption(this.backendSessionId, 'model', modelId);
    this.options.applyConfigOptions(readConfigOptions(result));
    this.options.applyConfigOptions([{ id: 'model', currentValue: modelId }]);
    this.publishOptions();
  }

  async setEffort(effortId: string): Promise<void> {
    const modelId = this.options.modelId;
    if (modelId !== undefined && !this.options.modelSupportsEffort(modelId, effortId)) {
      throw new Error(`unsupported-grok-effort: ${effortId}`);
    }
    const result = await this.client.setConfigOption(this.backendSessionId, 'reasoning_effort', effortId);
    this.options.applyConfigOptions(readConfigOptions(result));
    this.options.applyConfigOptions([{ id: 'reasoning_effort', currentValue: effortId }]);
    this.publishOptions();
  }

  async setMode(modeId: string): Promise<void> {
    this.options.requestMode(modeId);
    this.publishOptions();
    await this.client.setMode(this.backendSessionId, modeId);
  }

  async prompt(input: PromptInput): Promise<AgentPromptOutcome> {
    if (this.released) {
      throw new Error('grok-session-released');
    }
    if (this.promptAbort !== undefined) {
      throw new Error('grok-prompt-active: Host admits one Grok prompt at a time');
    }
    const runId = this.ports.getCurrentRunId();
    const projector = new GrokTurnProjector({
      ...(runId !== undefined ? { runId } : {}),
      createMessageId: () => `grok-${randomUUID()}`,
      ...(this.ports.now ? { now: this.ports.now } : {}),
    });
    this.projector = projector;
    this.promptAbort = new AbortController();
    this.userCancelled = false;
    this.permissionRejected = false;
    try {
      const result = await this.client.prompt(
        { sessionId: this.backendSessionId, prompt: toContentBlocks(input) },
        { signal: this.promptAbort.signal },
      );
      const terminal = classifyGrokStopReason(result.stopReason, {
        userCancelled: this.userCancelled,
        permissionRejected: this.permissionRejected,
      });
      const lastMessageId = projector.latestAssistantMessageId;
      this.emitAll(projector.finish(terminal.status === 'completed' ? 'completed' : terminal.status === 'aborted' ? 'aborted' : 'failed'));
      const usage = parseGrokPromptUsage(result._meta);
      if (usage !== undefined && lastMessageId !== undefined) {
        this.emit({
          type: 'usage/finalized',
          measurement: {
            measurementId: `${this.id}:${lastMessageId}`,
            sessionId: this.id,
            ...(runId !== undefined ? { runId } : {}),
            messageId: lastMessageId,
            ...(usage.modelId !== undefined ? { modelId: usage.modelId } : {}),
            ...(usage.inputTokens !== undefined ? { promptTokens: usage.inputTokens } : {}),
            ...(usage.outputTokens !== undefined ? { completionTokens: usage.outputTokens } : {}),
            ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
            ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
            totalTokens: usage.totalTokens,
            ...(usage.durationMs !== undefined ? { durationMs: usage.durationMs } : {}),
            stopReason: result.stopReason,
            recordedAt: this.now(),
          },
        });
      }
      switch (terminal.status) {
        case 'completed':
          return { status: 'completed', stopReason: terminal.stopReason };
        case 'aborted':
          return terminal.reason === 'permission-rejected'
            ? { status: 'completed', stopReason: 'handled' }
            : { status: 'aborted', stopReason: 'aborted' };
        case 'failed':
          return { status: 'failed', stopReason: 'error', failure: createUnknownAgentFailure(terminal.message) };
      }
    } catch (error) {
      this.emitAll(projector.finish(this.userCancelled ? 'aborted' : 'failed'));
      if (this.userCancelled) {
        return { status: 'aborted', stopReason: 'aborted' };
      }
      return {
        status: 'failed',
        stopReason: 'error',
        failure: {
          code: this.connection.closed ? 'backend-worker-crash' : 'backend-protocol-error',
          origin: 'protocol',
          message: `Grok: ${formatError(error)}`.slice(0, 500),
          retriable: false,
        },
      };
    } finally {
      this.projector = undefined;
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
    const settled = await waitFor(() => this.promptAbort !== active, CANCEL_GRACE_MS);
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
      this.handleNotification(method, params);
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

  private rebind(backendSessionId: string): GrokSessionHandle {
    // The constructor is private; session/new returns the id only after the
    // handle is listening, so rewrite the readonly binding once here.
    (this as { backendSessionId: string }).backendSessionId = backendSessionId;
    return this;
  }

  private async applyInitialSelections(input: GrokSessionOpenInput): Promise<void> {
    if (input.modelId !== undefined && input.modelId !== this.options.modelId && this.options.hasModel(input.modelId)) {
      await this.setModel(input.modelId);
    }
    if (input.effortId !== undefined) {
      const modelId = this.options.modelId;
      if (modelId === undefined || this.options.modelSupportsEffort(modelId, input.effortId)) {
        await this.setEffort(input.effortId);
      }
    }
    if (input.modeId !== undefined) {
      await this.setMode(input.modeId);
    }
  }

  private beginReplay(buffer: AgentEvent[]): void {
    this.replayBuffer = buffer;
    this.projector = new GrokTurnProjector({
      createMessageId: () => `grok-replay-${randomUUID()}`,
      ...(this.ports.now ? { now: this.ports.now } : {}),
    });
  }

  private endReplay(): void {
    if (this.projector !== undefined && this.replayBuffer !== undefined) {
      this.replayBuffer.push(...this.projector.finish('completed'));
    }
    this.projector = undefined;
    this.replayBuffer = undefined;
  }

  private handleNotification(method: string, params: unknown): void {
    const record = asRecord(params);
    if (method === '_x.ai/models/update') {
      this.options.applyModels(params);
      this.publishOptions();
      return;
    }
    if (method !== 'session/update' || record === undefined) {
      return;
    }
    // Grok pushes setup-time updates (commands, models) before `session/new`
    // returns the id; accept them while the id is still unbound. One process
    // serves exactly one session, so there is no cross-talk.
    if (this.backendSessionId !== '' && record.sessionId !== this.backendSessionId) {
      return;
    }
    const update = asRecord(record.update);
    if (this.replayBuffer !== undefined && update?.sessionUpdate === 'user_message_chunk') {
      this.replayBuffer.push(...this.replayUserMessage(update));
      return;
    }
    const projector = this.projector;
    if (projector === undefined) {
      // Idle-time updates (commands, mode, title) still matter.
      this.applySignals(new GrokTurnProjector({ createMessageId: () => 'unused' }).project(update).signals);
      return;
    }
    const projection = projector.project(update);
    if (this.replayBuffer !== undefined) {
      this.replayBuffer.push(...projection.events);
    } else {
      this.emitAll(projection.events);
    }
    this.applySignals(projection.signals);
  }

  /** Replay a user row: close any open assistant text, then emit a user message. */
  private replayUserMessage(update: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = [];
    if (this.projector !== undefined) {
      events.push(...this.projector.finish('completed'));
    }
    this.projector = new GrokTurnProjector({
      createMessageId: () => `grok-replay-${randomUUID()}`,
      ...(this.ports.now ? { now: this.ports.now } : {}),
    });
    const content = asRecord(update.content);
    const text = typeof content?.text === 'string' ? content.text : '';
    if (text !== '') {
      const messageId = `grok-replay-${randomUUID()}`;
      events.push(
        { type: 'message/start', messageId, role: 'user' },
        { type: 'message/text_delta', messageId, delta: text },
        { type: 'message/end', messageId },
      );
    }
    return events;
  }

  private applySignals(signals: ReturnType<GrokTurnProjector['project']>['signals']): void {
    let optionsChanged = false;
    for (const signal of signals) {
      switch (signal.kind) {
        case 'title':
          this.ports.onTitle(signal.title);
          break;
        case 'mode':
          this.options.confirmMode(signal.modeId);
          optionsChanged = true;
          break;
        case 'commands':
          this.options.applyCommands(signal.commands);
          optionsChanged = true;
          break;
        case 'config-options':
          this.options.applyConfigOptions(signal.configOptions);
          optionsChanged = true;
          break;
        case 'plan':
          break;
      }
    }
    if (optionsChanged) {
      this.publishOptions();
    }
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readConfigOptions(result: unknown): unknown {
  return asRecord(result)?.configOptions;
}

/** Plain text plus `@` file references as embedded resources. */
function toContentBlocks(input: PromptInput): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = [{ type: 'text', text: input.text }];
  for (const ref of input.contextRefs ?? []) {
    if (ref.kind === 'file') {
      const path = `${ref.projectPath.replace(/\/$/, '')}/${ref.relativePath}`;
      blocks.push({ type: 'resource_link', uri: `file://${path}`, name: ref.label });
    }
  }
  return blocks;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}
