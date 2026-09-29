import type { AcpLineTransport, AcpTransportCloseInfo } from './acp-line-transport.js';
import {
  AcpConnectionClosedError,
  AcpRequestTimeoutError,
  AcpRpcError,
} from './acp-errors.js';
import type { JsonRpcFailure, JsonRpcId, JsonRpcRequest, JsonRpcSuccess } from './json-rpc-message.js';
import { parseJsonRpcLine } from './json-rpc-message.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export type AcpProtocolIssue = {
  kind: 'invalid-line' | 'unmatched-response' | 'handler-failed';
  method?: string;
  reason: string;
};

export type JsonRpcConnectionOptions = {
  defaultTimeoutMs?: number;
  droppedNotificationMethods?: ReadonlySet<string>;
  onProtocolIssue?: (issue: AcpProtocolIssue) => void;
};

export type AcpNotificationListener = (method: string, params: unknown) => void;
export type AcpRequestHandler = (params: unknown) => Promise<unknown>;
export type AcpCloseListener = (info: AcpTransportCloseInfo) => void;

type PendingEntry = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
};

export class JsonRpcConnection {
  private readonly transport: AcpLineTransport;
  private readonly defaultTimeoutMs: number;
  private readonly droppedNotificationMethods: ReadonlySet<string>;
  private readonly onProtocolIssue: ((issue: AcpProtocolIssue) => void) | undefined;
  private readonly pending = new Map<JsonRpcId, PendingEntry>();
  private readonly notificationListeners = new Set<AcpNotificationListener>();
  private readonly closeListeners = new Set<AcpCloseListener>();
  private readonly requestHandlers = new Map<string, AcpRequestHandler>();
  private nextId = 1;
  private isClosed = false;
  private closePromise: Promise<void> | undefined;

  constructor(transport: AcpLineTransport, options?: JsonRpcConnectionOptions) {
    this.transport = transport;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.droppedNotificationMethods = options?.droppedNotificationMethods ?? new Set();
    this.onProtocolIssue = options?.onProtocolIssue;
    transport.onLine((line) => {
      this.handleLine(line);
    });
    transport.onClose((info) => {
      this.handleTransportClose(info);
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<T> {
    if (this.isClosed) {
      return Promise.reject(new AcpConnectionClosedError({ method, reason: 'closed' }));
    }
    const signal = options?.signal;
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }

    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      const entry: PendingEntry = {
        method,
        resolve: (value) => {
          resolve(value as T);
        },
        reject,
        timer: undefined,
        signal,
        onAbort: undefined,
      };

      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.forgetPending(id);
          reject(new AcpRequestTimeoutError(method, timeoutMs));
        }, timeoutMs);
      }

      if (signal !== undefined) {
        const onAbort = (): void => {
          this.forgetPending(id);
          reject(signal.reason);
        };
        entry.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.set(id, entry);
      try {
        this.sendPayload(this.buildRequest(id, method, params));
      } catch (error) {
        this.forgetPending(id);
        reject(error);
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.isClosed) {
      throw new AcpConnectionClosedError({ method, reason: 'closed' });
    }
    this.sendPayload(this.buildNotification(method, params));
  }

  onNotification(listener: AcpNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  setRequestHandler(method: string, handler: AcpRequestHandler): () => void {
    this.requestHandlers.set(method, handler);
    return () => {
      if (this.requestHandlers.get(method) === handler) {
        this.requestHandlers.delete(method);
      }
    };
  }

  onClose(listener: AcpCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    this.closePromise = this.closeInternal({ code: null, signal: null, reason: 'closed' });
    return this.closePromise;
  }

  private async closeInternal(info: AcpTransportCloseInfo): Promise<void> {
    this.markClosed(info);
    await this.transport.close();
  }

  private handleTransportClose(info: AcpTransportCloseInfo): void {
    this.markClosed(info);
  }

  private markClosed(info: AcpTransportCloseInfo): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    const reason = info.reason ?? 'closed';
    for (const [id, entry] of this.pending) {
      this.forgetPending(id);
      entry.reject(new AcpConnectionClosedError({ method: entry.method, reason }));
    }
    for (const listener of this.closeListeners) {
      try {
        listener(info);
      } catch (error) {
        this.reportIssue({
          kind: 'handler-failed',
          reason: errorName(error),
        });
      }
    }
  }

  private handleLine(line: string): void {
    if (this.isClosed) {
      return;
    }
    const parsed = parseJsonRpcLine(line);
    if (parsed.kind === 'invalid') {
      this.reportIssue({ kind: 'invalid-line', reason: parsed.reason });
      return;
    }
    if (parsed.kind === 'request') {
      void this.dispatchInboundRequest(parsed.message);
      return;
    }
    if (parsed.kind === 'notification') {
      this.dispatchNotification(parsed.message.method, parsed.message.params);
      return;
    }
    this.dispatchResponse(parsed.message);
  }

  private dispatchNotification(method: string, params: unknown): void {
    if (this.droppedNotificationMethods.has(method)) {
      return;
    }
    for (const listener of this.notificationListeners) {
      try {
        listener(method, params);
      } catch (error) {
        this.reportIssue({
          kind: 'handler-failed',
          method,
          reason: errorName(error),
        });
      }
    }
  }

  private async dispatchInboundRequest(message: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(message.method);
    if (handler === undefined) {
      this.sendInboundError(message.id, METHOD_NOT_FOUND, 'Method not found');
      return;
    }
    try {
      const result = await handler(message.params);
      this.sendInboundResult(message.id, result);
    } catch {
      this.sendInboundError(message.id, INTERNAL_ERROR, 'Internal error');
    }
  }

  private dispatchResponse(message: JsonRpcSuccess | JsonRpcFailure): void {
    const entry = this.pending.get(message.id);
    if (entry === undefined) {
      this.reportIssue({
        kind: 'unmatched-response',
        reason: `unmatched id ${String(message.id)}`,
      });
      return;
    }
    this.forgetPending(message.id);
    if ('error' in message) {
      const rpcError = new AcpRpcError({
        method: entry.method,
        code: message.error.code,
        rpcMessage: message.error.message,
        ...(message.error.data !== undefined ? { data: message.error.data } : {}),
      });
      entry.reject(rpcError);
      return;
    }
    entry.resolve(message.result);
  }

  private forgetPending(id: JsonRpcId): void {
    const entry = this.pending.get(id);
    if (entry === undefined) {
      return;
    }
    this.pending.delete(id);
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
    }
    if (entry.signal !== undefined && entry.onAbort !== undefined) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
  }

  private sendInboundResult(id: JsonRpcId, result: unknown): void {
    if (this.isClosed) {
      return;
    }
    this.sendPayload({ jsonrpc: '2.0', id, result });
  }

  private sendInboundError(id: JsonRpcId, code: number, message: string): void {
    if (this.isClosed) {
      return;
    }
    this.sendPayload({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private sendPayload(payload: Record<string, unknown>): void {
    this.transport.send(JSON.stringify(payload));
  }

  private buildRequest(id: number, method: string, params: unknown): Record<string, unknown> {
    if (params === undefined) {
      return { jsonrpc: '2.0', id, method };
    }
    return { jsonrpc: '2.0', id, method, params };
  }

  private buildNotification(method: string, params: unknown): Record<string, unknown> {
    if (params === undefined) {
      return { jsonrpc: '2.0', method };
    }
    return { jsonrpc: '2.0', method, params };
  }

  private reportIssue(issue: AcpProtocolIssue): void {
    if (this.onProtocolIssue === undefined) {
      return;
    }
    this.onProtocolIssue(issue);
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return 'unknown';
}
