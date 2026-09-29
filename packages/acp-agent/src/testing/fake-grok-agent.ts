/**
 * Scripted in-memory Grok ACP agent for tests (ADR 0082). Mirrors the
 * probed 1.0.41/1.0.44 wire behaviour: `_x.ai` prefixes, wrapped xAI
 * results, three-phase tool calls, permission requests whose rejection ends
 * the turn as `cancelled`, and a secret-bearing MCP notification that must be
 * dropped by the connection.
 */

import type { AcpLineTransport, AcpTransportCloseInfo } from '../acp-line-transport.js';

export type FakeGrokTurnStep =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; toolCallId: string; name: string; acpKind: string; title: string; path?: string; command?: string; output?: string; exitCode?: number }
  | { kind: 'permission'; toolCallId: string; title: string; path?: string }
  | { kind: 'wait-cancel' };

export type FakeGrokSession = {
  sessionId: string;
  cwd: string;
  title?: string;
  lastChangeUnixMs: number;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
};

export type FakeGrokAgentOptions = {
  version?: string;
  /** Script for each prompt, consumed in order. */
  turns?: FakeGrokTurnStep[][];
  sessions?: FakeGrokSession[];
  now?: () => number;
};

export type FakeGrokAgent = {
  /** Transport factory; every call is a new "process" sharing session state. */
  createTransport(): AcpLineTransport;
  readonly sessions: Map<string, FakeGrokSession>;
  readonly received: Array<{ method: string; params: unknown }>;
  /** Kill every live process (simulated crash). */
  crash(): void;
  readonly liveProcesses: number;
};

const SECRET = 'sk-fake-secret-0123456789';

export function createFakeGrokAgent(options: FakeGrokAgentOptions = {}): FakeGrokAgent {
  const sessions = new Map<string, FakeGrokSession>();
  for (const session of options.sessions ?? []) {
    sessions.set(session.sessionId, session);
  }
  const turns = [...(options.turns ?? [])];
  const received: Array<{ method: string; params: unknown }> = [];
  const processes = new Set<FakeProcess>();
  let sessionCounter = 0;
  const now = options.now ?? (() => Date.now());

  class FakeProcess implements AcpLineTransport {
    private readonly lineListeners = new Set<(line: string) => void>();
    private readonly closeListeners = new Set<(info: AcpTransportCloseInfo) => void>();
    private closed = false;
    private nextOutboundId = 1000;
    private readonly outbound = new Map<number, (result: unknown) => void>();
    private cancelled: (() => void) | undefined;

    send(line: string): void {
      if (this.closed) {
        throw new Error('fake grok process closed');
      }
      const message = JSON.parse(line) as { id?: number; method?: string; params?: unknown; result?: unknown };
      if (message.method === undefined && message.id !== undefined) {
        this.outbound.get(message.id)?.(message.result);
        this.outbound.delete(message.id);
        return;
      }
      if (message.method === undefined) {
        return;
      }
      received.push({ method: message.method, params: message.params });
      queueMicrotask(() => {
        void this.handle(message.method ?? '', message.id, message.params);
      });
    }

    onLine(listener: (line: string) => void): () => void {
      this.lineListeners.add(listener);
      return () => this.lineListeners.delete(listener);
    }

    onClose(listener: (info: AcpTransportCloseInfo) => void): () => void {
      this.closeListeners.add(listener);
      return () => this.closeListeners.delete(listener);
    }

    async close(): Promise<void> {
      this.terminate({ code: 0, signal: null });
    }

    terminate(info: AcpTransportCloseInfo): void {
      if (this.closed) return;
      this.closed = true;
      processes.delete(this);
      for (const listener of [...this.closeListeners]) listener(info);
    }

    private write(payload: Record<string, unknown>): void {
      if (this.closed) return;
      const line = JSON.stringify({ jsonrpc: '2.0', ...payload });
      for (const listener of [...this.lineListeners]) listener(line);
    }

    private reply(id: number | undefined, result: unknown): void {
      if (id !== undefined) this.write({ id, result });
    }

    private fail(id: number | undefined, code: number, message: string): void {
      if (id !== undefined) this.write({ id, error: { code, message } });
    }

    private update(sessionId: string, update: Record<string, unknown>): void {
      this.write({ method: 'session/update', params: { sessionId, update } });
    }

    private request(method: string, params: unknown): Promise<unknown> {
      const id = this.nextOutboundId++;
      return new Promise((resolve) => {
        this.outbound.set(id, resolve);
        this.write({ id, method, params });
      });
    }

    private setupResult(sessionId: string): Record<string, unknown> {
      return {
        sessionId,
        models: {
          currentModelId: 'grok-4.7-build-fast',
          availableModels: [
            { modelId: 'grok-4.7', name: 'Grok 4.7', _meta: { totalContextTokens: 256000, supportsReasoningEffort: true, reasoningEfforts: [{ value: 'high', default: true }, { value: 'low' }] } },
            { modelId: 'grok-4.7-build-fast', name: 'Grok 4.7 Fast', _meta: { supportsReasoningEffort: false } },
          ],
        },
        configOptions: [{ id: 'model', currentValue: 'grok-4.7-build-fast' }],
      };
    }

    private async handle(method: string, id: number | undefined, params: unknown): Promise<void> {
      const record = (params ?? {}) as Record<string, unknown>;
      const sessionId = typeof record.sessionId === 'string' ? record.sessionId : '';
      switch (method) {
        case 'initialize':
          // Secret-bearing notification that the client must drop.
          this.write({ method: '_x.ai/mcp/servers_updated', params: { servers: [{ name: 'x', env: { API_KEY: SECRET } }] } });
          this.reply(id, {
            protocolVersion: 1,
            authMethods: [{ id: 'cached_token' }],
            _meta: { agentVersion: options.version ?? '1.0.44', defaultAuthMethodId: 'cached_token', hostname: 'secret-host' },
          });
          return;
        case 'session/new': {
          sessionCounter += 1;
          const created: FakeGrokSession = { sessionId: `grok-session-${sessionCounter}`, cwd: String(record.cwd), lastChangeUnixMs: now(), history: [] };
          sessions.set(created.sessionId, created);
          this.update(created.sessionId, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact' }] });
          this.reply(id, this.setupResult(created.sessionId));
          return;
        }
        case 'session/resume':
        case 'session/load': {
          const session = sessions.get(sessionId);
          if (session === undefined) {
            this.fail(id, -32602, 'unknown session');
            return;
          }
          if (method === 'session/load') {
            for (const entry of session.history) {
              this.update(sessionId, {
                sessionUpdate: entry.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
                content: { type: 'text', text: entry.text },
              });
            }
          }
          this.reply(id, this.setupResult(sessionId));
          return;
        }
        case 'session/set_config_option':
          this.reply(id, { configOptions: [{ id: String(record.configId), currentValue: String(record.value) }] });
          return;
        case 'session/set_mode':
          if (record.modeId === 'plan') this.update(sessionId, { sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
          this.reply(id, {});
          return;
        case 'session/cancel':
          this.cancelled?.();
          return;
        case 'session/prompt':
          await this.runTurn(id, sessionId, record);
          return;
        case '_x.ai/interject':
          this.reply(id, { result: { status: 'queued' } });
          return;
        case '_x.ai/sessions/list':
          this.reply(id, {
            result: {
              sessions: [...sessions.values()].map((session) => ({
                sessionId: session.sessionId,
                title: session.title ?? null,
                cwd: session.cwd,
                activity: 'idle',
                lastChangeUnixMs: session.lastChangeUnixMs,
                origin: { kind: 'acp' },
              })),
            },
          });
          return;
        case '_x.ai/session/rename': {
          const session = sessions.get(sessionId);
          if (session !== undefined) session.title = String(record.title);
          this.reply(id, { success: session !== undefined });
          return;
        }
        case '_x.ai/session/delete':
          this.reply(id, { success: sessions.delete(sessionId) });
          return;
        default:
          this.fail(id, -32601, `unknown ACP extension method: ${method}`);
      }
    }

    private async runTurn(id: number | undefined, sessionId: string, params: Record<string, unknown>): Promise<void> {
      const session = sessions.get(sessionId);
      const prompt = Array.isArray(params.prompt) ? params.prompt : [];
      const firstText = prompt.find((block): block is { type: 'text'; text: string } => typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text');
      session?.history.push({ role: 'user', text: firstText?.text ?? '' });
      const steps = turns.shift() ?? [{ kind: 'text', text: 'ok' }];
      let reply = '';
      for (const step of steps) {
        if (this.closed) return;
        switch (step.kind) {
          case 'text':
            reply += step.text;
            this.update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: step.text } });
            break;
          case 'thought':
            this.update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: step.text } });
            break;
          case 'tool':
            this.update(sessionId, { sessionUpdate: 'tool_call', toolCallId: step.toolCallId, title: step.name, status: 'pending', rawInput: { ...(step.path ? { path: step.path } : {}), ...(step.command ? { command: step.command } : {}) }, _meta: { 'x.ai/tool': { name: step.name } } });
            this.update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: step.toolCallId, kind: step.acpKind, title: step.title, ...(step.path ? { content: [{ type: 'diff', path: step.path, oldText: null, newText: 'x' }] } : {}) });
            this.update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: step.toolCallId, status: 'in_progress' });
            this.update(sessionId, {
              sessionUpdate: 'tool_call_update',
              toolCallId: step.toolCallId,
              status: step.exitCode !== undefined && step.exitCode !== 0 ? 'failed' : 'completed',
              ...(step.command ? { rawOutput: { exit_code: step.exitCode ?? 0, output: step.output ?? '', truncated: false, timed_out: false } } : {}),
            });
            break;
          case 'permission': {
            const outcome = (await this.request('session/request_permission', {
              sessionId,
              toolCall: { toolCallId: step.toolCallId, kind: 'edit', title: step.title, rawInput: step.path ? { path: step.path } : {} },
              options: [
                { optionId: 'allow-edits-session', kind: 'allow_always', name: 'Yes, allow all edits during this session' },
                { optionId: 'allow-once', kind: 'allow_once', name: 'Yes' },
                { optionId: 'reject-once', kind: 'reject_once', name: 'No, and tell Grok what to do differently' },
              ],
            })) as { outcome?: { outcome?: string; optionId?: string } } | undefined;
            const optionId = outcome?.outcome?.optionId;
            if (outcome?.outcome?.outcome !== 'selected' || optionId === 'reject-once') {
              this.reply(id, { stopReason: 'cancelled', _meta: {} });
              return;
            }
            break;
          }
          case 'wait-cancel':
            await new Promise<void>((resolve) => {
              this.cancelled = resolve;
            });
            this.cancelled = undefined;
            this.reply(id, { stopReason: 'cancelled', _meta: { cancellationCategory: 'user' } });
            return;
        }
      }
      if (session !== undefined) {
        session.history.push({ role: 'assistant', text: reply });
        session.lastChangeUnixMs = now();
        if (session.title === undefined && reply !== '') {
          session.title = 'Fake title';
          this.update(sessionId, { sessionUpdate: 'session_info_update', title: 'Fake title' });
        }
      }
      this.reply(id, {
        stopReason: 'end_turn',
        _meta: { modelId: 'grok-4.7-build-fast', usage: { inputTokens: 12, outputTokens: 3, cachedReadTokens: 4, costUsdTicks: 9 } },
      });
    }
  }

  return {
    createTransport() {
      const process = new FakeProcess();
      processes.add(process);
      return process;
    },
    sessions,
    received,
    crash() {
      for (const process of [...processes]) process.terminate({ code: 1, signal: null, reason: 'crashed' });
    },
    get liveProcesses() {
      return processes.size;
    },
  };
}

export const FAKE_GROK_SECRET = SECRET;
