import type { WebSocketLike } from '@piwin/host-transport';
import WebSocket from 'ws';

type OpenHandler = (() => void) | null;
type MessageHandler = ((event: { data: unknown }) => void) | null;
type ErrorHandler = ((event: unknown) => void) | null;
type CloseHandler = ((event: { code: number; reason: string }) => void) | null;

/**
 * Node 20 has no global WebSocket. Prefer the platform global when present
 * (Node 22+ / browsers); otherwise use the `ws` package.
 */
export function createNodeHostWebSocket(endpoint: string): WebSocketLike {
  const GlobalWebSocket = (
    globalThis as unknown as { WebSocket?: new (url: string) => WebSocketLike }
  ).WebSocket;
  if (typeof GlobalWebSocket === 'function') {
    return new GlobalWebSocket(endpoint);
  }

  return new NodeWsHostSocket(endpoint);
}

class NodeWsHostSocket implements WebSocketLike {
  public onopen: OpenHandler = null;
  public onmessage: MessageHandler = null;
  public onerror: ErrorHandler = null;
  public onclose: CloseHandler = null;

  private readonly socket: WebSocket;

  public constructor(endpoint: string) {
    this.socket = new WebSocket(endpoint);
    this.socket.on('open', () => {
      this.onopen?.();
    });
    this.socket.on('message', (data) => {
      this.onmessage?.({ data: typeof data === 'string' ? data : data.toString() });
    });
    this.socket.on('error', (error) => {
      this.onerror?.(error);
    });
    this.socket.on('close', (code, reason) => {
      this.onclose?.({ code, reason: reason.toString() });
    });
  }

  public get readyState(): number {
    return this.socket.readyState;
  }

  public send(data: string): void {
    this.socket.send(data);
  }

  public close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}
