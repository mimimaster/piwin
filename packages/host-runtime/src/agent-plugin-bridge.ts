/**
 * Host-side Agent plugin bridge (ADR 0082).
 *
 * Owns one installed adapter process and speaks the Host↔plugin frame
 * protocol. It never imports vendor ACP/xAI code and never parses vendor
 * wire fields: envelopes are decoded here, payloads stay typed by the
 * contracts protocol map. The caller owns Runs, permissions, media import
 * and transcript projection.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import {
  AGENT_PLUGIN_PROTOCOL_VERSION,
  AgentPluginProtocolError,
  formatError,
  parseAgentPluginFrame,
  parseAgentPluginMediaProposal,
  parseAgentPluginPromptOutcome,
  type AgentPluginAgentEmission,
  type AgentPluginHostCapabilities,
  type AgentPluginEmission,
  type AgentPluginMethod,
  type AgentPluginMethodMap,
  type AgentPluginProtocolFailure,
  type AgentPluginScope,
  type AgentPluginSessionScope,
  type AgentPromptOutcome,
  type BackendRunInterventionEvent,
  type BackendRunInterventionEventResult,
  type ExternalAgentMcpServerStatus,
  type SessionBackendOptions,
  type AgentPluginPermissionDecision,
  type AgentPluginPermissionPrompt,
} from '@piwin/contracts';
import { disposeAgentPluginProcess } from './agent-plugin-process-disposal.js';

export class AgentPluginBridgeError extends Error {
  override readonly name = 'AgentPluginBridgeError';
  constructor(readonly code: AgentPluginFailureCode, message: string) {
    super(message);
  }
}

type AgentPluginFailureCode = AgentPluginProtocolFailure['code'] | 'plugin-exited' | 'plugin-closed' | 'plugin-timeout';

/** A Host-side answer to a plugin callback. Errors answer the plugin, never crash the bridge. */
export type AgentPluginCallbackHandlers = {
  requestPermission: (prompt: AgentPluginPermissionPrompt, scope: AgentPluginSessionScope) => Promise<AgentPluginPermissionDecision>;
  interventionEvent: (event: BackendRunInterventionEvent, scope: AgentPluginSessionScope) => Promise<BackendRunInterventionEventResult>;
};

export type AgentPluginBridgeOptions = {
  /** Absolute path to the installed, digest-verified `agent.mjs`. */
  entrypoint: string;
  agentId: string;
  pluginRevision: string;
  runtime: { binaryPath?: string };
  hostCapabilities?: AgentPluginHostCapabilities;
  /** Session boundary: emissions from another session/generation are dropped. */
  resolveSessionScope: (scope: AgentPluginSessionScope) => boolean;
  onSessionEmission: (emission: AgentPluginEmission, scope: AgentPluginSessionScope) => void;
  callbacks: AgentPluginCallbackHandlers;
  /** Fired exactly once, on process exit or explicit dispose. */
  onClosed: (reason: string) => void;
  env?: NodeJS.ProcessEnv;
  nodePath?: string;
  /** Control request deadline; prompts wait for their terminal outcome or process closure. */
  requestTimeoutMs?: number;
  maxFrameBytes?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Callback answers are Host-local decisions; they still get a bound. */
const CALLBACK_TIMEOUT_MS = 5_000;
const DISPOSE_ACK_GRACE_MS = 1_000;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | undefined;
  /** Diagnostics only: which method a rejected-in-flight call was waiting on. */
  method: AgentPluginMethod;
  scope: AgentPluginScope;
};

export class AgentPluginBridge {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly options: AgentPluginBridgeOptions;
  private writeChain: Promise<void> = Promise.resolve();
  private closeReason: string | undefined;
  /** Set after dispose so a late plugin notification cannot reach the Host. */
  private disposed = false;
  private requestUsageSupported = false;
  private disposal: Promise<void> | undefined;

  private constructor(options: AgentPluginBridgeOptions, child: ChildProcessWithoutNullStreams) {
    this.options = options;
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      void this.handleLine(line).catch((error: unknown) => {
        this.close(error instanceof AgentPluginProtocolError ? error.message : `agent-plugin-protocol-error: ${formatError(error)}`);
      });
    });
    child.stdin.on('error', (error) => this.close(`plugin-write-failed: ${formatError(error)}`));
    child.on('error', (error) => this.close(`plugin-spawn-failed: ${formatError(error)}`));
    child.on('exit', (code, signal) => this.close(`plugin-exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`));
    child.stderr.resume();
  }

  static start(options: AgentPluginBridgeOptions): AgentPluginBridge {
    const child = spawn(options.nodePath ?? process.execPath, [options.entrypoint], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    });
    return new AgentPluginBridge(options, child);
  }

  get closed(): boolean {
    return this.closeReason !== undefined;
  }

  get supportsRequestUsage(): boolean {
    return this.requestUsageSupported;
  }

  async initialize(): Promise<void> {
    const result = await this.request('plugin/initialize', {
      agentId: this.options.agentId,
      pluginRevision: this.options.pluginRevision,
      hostProtocolVersion: AGENT_PLUGIN_PROTOCOL_VERSION,
      runtime: this.options.runtime,
      ...(this.options.hostCapabilities !== undefined ? { hostCapabilities: this.options.hostCapabilities } : {}),
    });
    if (result.agentId !== this.options.agentId) {
      throw new AgentPluginBridgeError('invalid-request', `plugin initialized as ${result.agentId}`);
    }
    this.requestUsageSupported = result.requestUsage === true;
  }

  /** Typed request. Scope is derived from the method so a caller cannot mis-scope one. */
  request<Method extends AgentPluginMethod>(
    method: Method,
    params: AgentPluginMethodMap[Method]['params'],
    scope?: AgentPluginScope,
  ): Promise<AgentPluginMethodMap[Method]['result']> {
    if (this.closeReason !== undefined) {
      return Promise.reject(new AgentPluginBridgeError('plugin-closed', this.closeReason));
    }
    const framedScope = scope ?? pluginScopeFor(method);
    const requestId = randomUUID();
    const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      // Prompt responses carry the whole turn's outcome, unlike short control ACKs.
      // Thinking, tools and approval waits can legitimately exceed this deadline.
      const timer = method === 'session/prompt' ? undefined : setTimeout(() => {
        this.pending.delete(requestId);
        reject(new AgentPluginBridgeError('plugin-timeout', `${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method,
        scope: framedScope,
      });
      this.write({
        protocolVersion: AGENT_PLUGIN_PROTOCOL_VERSION,
        kind: 'request',
        scope: framedScope,
        requestId,
        method,
        params,
      });
    });
  }

  /** Prompt is the only method whose payload is re-validated before it can terminalize a Run. */
  async prompt(scope: AgentPluginSessionScope, params: { input: unknown; runId: string }): Promise<AgentPromptOutcome> {
    const result = await this.request('session/prompt', params as AgentPluginMethodMap['session/prompt']['params'], sessionScope(scope));
    return parseAgentPluginPromptOutcome(result);
  }

  async dispose(): Promise<void> {
    this.disposal ??= this.disposeOwnedChild();
    await this.disposal;
  }

  private async disposeOwnedChild(): Promise<void> {
    this.disposed = true;
    if (this.closeReason === undefined) {
      try {
        await withTimeout(this.request('plugin/dispose', {}, { kind: 'plugin' }), DISPOSE_ACK_GRACE_MS, null);
      } catch {
        // The close handler already records a dead peer; cleanup still owns the child.
      }
    }
    try {
      this.close('plugin-disposed');
    } finally {
      await disposeAgentPluginProcess(this.child);
    }
  }

  private write(frame: unknown): void {
    const line = `${JSON.stringify(frame)}\n`;
    this.writeChain = this.writeChain.then(() => new Promise<void>((resolve) => {
      if (this.child.stdin.destroyed) return resolve();
      this.child.stdin.write(line, () => resolve());
    }));
  }

  private async handleLine(line: string): Promise<void> {
    if (this.closeReason !== undefined || line.trim() === '') return;
    let frame;
    try {
      frame = parseAgentPluginFrame(line);
    } catch (error) {
      // A malformed frame is not recoverable: the peer broke the protocol.
      this.close(error instanceof AgentPluginProtocolError ? error.message : 'agent-plugin-protocol-error');
      return;
    }
    if (frame.kind === 'response') {
      const waiter = this.pending.get(frame.requestId);
      if (waiter === undefined) return;
      parseAgentPluginFrame(line, { scope: waiter.scope, method: waiter.method, kind: 'response' });
      this.pending.delete(frame.requestId);
      if (waiter.timer !== undefined) clearTimeout(waiter.timer);
      if (frame.ok) waiter.resolve(frame.result);
      else waiter.reject(new AgentPluginBridgeError(frame.error.code, frame.error.message));
      return;
    }
    if (frame.kind === 'event') {
      this.deliverEvent(frame.scope, frame.emission);
      return;
    }
    await this.answerCallback(frame.scope, frame.requestId, frame.method, frame.params);
  }

  private deliverEvent(scope: AgentPluginSessionScope, emission: unknown): void {
    if (this.disposed) return;
    if (!this.options.resolveSessionScope(scope)) return;
    const normalized = normalizeEmission(emission);
    if (normalized === undefined) return;
    this.options.onSessionEmission(normalized, scope);
  }

  private async answerCallback(scope: AgentPluginScope, requestId: string, method: AgentPluginMethod, params: unknown): Promise<void> {
    const respond = (payload: { ok: true; result: unknown } | { ok: false; error: AgentPluginProtocolFailure }): void => {
      if (scope.kind !== 'session') return;
      this.write({
        protocolVersion: AGENT_PLUGIN_PROTOCOL_VERSION,
        kind: 'response',
        scope,
        requestId,
        method,
        ...payload,
      });
    };
    if (scope.kind !== 'session') {
      respond({ ok: false, error: { code: 'invalid-request', message: 'session callback requires session scope' } });
      return;
    }
    try {
      if (method === 'permission/request') {
        const result = await withTimeout(
          this.options.callbacks.requestPermission(params as AgentPluginPermissionPrompt, scope),
          CALLBACK_TIMEOUT_MS,
          { cancelled: true } as AgentPluginPermissionDecision,
        );
        respond({ ok: true, result });
        return;
      }
      if (method === 'intervention/event') {
        const result = await withTimeout(
          this.options.callbacks.interventionEvent(params as BackendRunInterventionEvent, scope),
          CALLBACK_TIMEOUT_MS,
          { accepted: false } as BackendRunInterventionEventResult,
        );
        respond({ ok: true, result });
        return;
      }
      respond({ ok: false, error: { code: 'unsupported', message: `unsupported callback ${method}` } });
    } catch (error) {
      respond({ ok: false, error: { code: 'backend-error', message: formatError(error) } });
    }
  }

  private close(reason: string): void {
    if (this.closeReason !== undefined) return;
    this.closeReason = reason;
    for (const [requestId, waiter] of this.pending) {
      if (waiter.timer !== undefined) clearTimeout(waiter.timer);
      waiter.reject(new AgentPluginBridgeError('plugin-exited', `${reason} (in flight: ${waiter.method})`));
      this.pending.delete(requestId);
    }
    try {
      this.options.onClosed(reason);
    } finally {
      void this.dispose().catch((error: unknown) => console.warn('agent plugin cleanup failed:', formatError(error)));
    }
  }

  /** Called by the owner after a session is released; late emissions are then dropped. */
  markDisposed(): void {
    this.disposed = true;
  }
}

function pluginScopeFor(method: AgentPluginMethod): AgentPluginScope {
  return method.startsWith('plugin/') || method.startsWith('catalog/') || method === 'check'
    ? { kind: 'plugin' }
    : (() => { throw new AgentPluginBridgeError('invalid-request', `${method} requires an explicit session scope`); })();
}

function sessionScope(scope: AgentPluginSessionScope): AgentPluginScope {
  return { kind: 'session', sessionId: scope.sessionId, runtimeGenerationId: scope.runtimeGenerationId };
}

function normalizeEmission(value: unknown): AgentPluginEmission | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const emission = value as Record<string, unknown>;
  if (emission.type === 'agent') {
    if (typeof emission.event !== 'object' || emission.event === null) return undefined;
    const media = Array.isArray(emission.media) ? emission.media.map(parseAgentPluginMediaProposal) : undefined;
    const normalized: AgentPluginAgentEmission = {
      type: 'agent',
      event: emission.event as AgentPluginAgentEmission['event'],
      ...(media !== undefined ? { media } : {}),
    };
    return normalized;
  }
  if (emission.type === 'title' && typeof emission.title === 'string') return { type: 'title', title: emission.title };
  if (emission.type === 'options' && typeof emission.options === 'object' && emission.options !== null) {
    return { type: 'options', options: emission.options as SessionBackendOptions };
  }
  if (emission.type === 'mcp-status' && Array.isArray(emission.servers)) {
    return { type: 'mcp-status', servers: emission.servers as ExternalAgentMcpServerStatus[], observed: emission.observed === true };
  }
  if (emission.type === 'closed' && typeof emission.reason === 'string') return { type: 'closed', reason: emission.reason };
  return undefined;
}

async function withTimeout<Value>(operation: Promise<Value>, ms: number, fallback: Value): Promise<Value> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<Value>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
