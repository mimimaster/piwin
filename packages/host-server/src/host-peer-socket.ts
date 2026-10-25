import type { RawData, WebSocket } from 'ws';

/**
 * The socket surface a Host connection needs. A `ws` socket satisfies it
 * through {@link wrapWsPeerSocket}; an end-to-end channel peer (ADR 0101)
 * implements it over its own transport so HostServer admission, replay and
 * egress stay unchanged.
 *
 * `readyState` uses the WebSocket numbering (0 connecting, 1 open, 2 closing,
 * 3 closed). Inbound frames are delivered as text: the Host wire is JSON.
 */
export type HostPeerSocket = {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
  /** Drop the transport without a close handshake (dead or half-open peer). */
  terminate(): void;
  /** Liveness probe; the peer answers through `onPong`. */
  ping(): void;
  onMessage(listener: (text: string) => void): void;
  onPong(listener: () => void): void;
  onClose(listener: (code: number, reason: string) => void): void;
  onError(listener: (error: unknown) => void): void;
};

export function wrapWsPeerSocket(socket: WebSocket): HostPeerSocket {
  return {
    get readyState() {
      return socket.readyState;
    },
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    terminate: () => socket.terminate(),
    ping: () => socket.ping(),
    onMessage: (listener) => {
      socket.on('message', (data: RawData) => listener(rawDataToText(data)));
    },
    onPong: (listener) => {
      socket.on('pong', () => listener());
    },
    onClose: (listener) => {
      socket.on('close', (code, reason) => listener(code, reason.toString()));
    },
    onError: (listener) => {
      socket.on('error', listener);
    },
  };
}

function rawDataToText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString();
  }
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString();
}
