import { classifyBinaryFrameSource } from '../binary-frame-bytes.js';
import type { WebSocketFactory, WebSocketLike } from '../websocket-host-transport.js';
import {
  CHANNEL_KIND_TEXT,
  ChannelReassembler,
  fragmentChannelMessage,
} from './channel-fragment.js';
import { NoiseChannel } from './noise/noise-channel.js';
import { NoiseIkHandshake, type NoiseKeyPair } from './noise/noise-ik-handshake.js';
import { packRelayFrame, unpackRelayFrame } from './relay-envelope.js';
import { RemoteChannelError } from './remote-channel-error.js';
import { remoteChannelPrologue } from './remote-identity.js';

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * Close codes this socket synthesizes. 4004 matches the Host's
 * "authentication failed" and is fatal to `WebSocketHostTransport`: a Host key
 * that does not match the pinned one needs a re-pair, not a retry. 4007 (a
 * broken channel after the handshake) reconnects with a fresh handshake.
 */
export const RELAY_SECURE_SOCKET_CLOSE = {
  handshakeFailed: 4004,
  channelFailed: 4007,
} as const;

/** The platform socket under the channel; it must carry binary frames. */
export type RelayInnerSocket = {
  readonly readyState: number;
  binaryType?: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
};

export type RelayInnerSocketFactory = (url: string) => RelayInnerSocket;

export type RelaySecureSocketOptions = {
  /** Full channel URL, relay or direct: `…/v1/u/<userId>/connect?hostId=…`. */
  url: string;
  userId: string;
  hostId: string;
  /** X25519 Host static key pinned at pairing. */
  hostKey: Uint8Array;
  clientStaticKeyPair: NoiseKeyPair;
  createInnerSocket: RelayInnerSocketFactory;
  rekeyInterval?: number;
  /** Test vectors only. */
  ephemeralKeyPair?: NoiseKeyPair;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Client end of the ADR 0101 channel, shaped as a `WebSocketLike` so
 * `WebSocketHostTransport` (hello, heartbeat, backoff, replay) runs over it
 * unchanged. It reports open only after the Noise IK handshake, sends wire
 * JSON as encrypted text messages and surfaces Host binary messages as bytes.
 *
 * Frames are processed synchronously in arrival order: Noise nonces cannot
 * skip, so the inner socket must deliver binary as ArrayBuffer or bytes.
 */
export class RelaySecureSocket implements WebSocketLike {
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  private state: number = CONNECTING;
  private readonly inner: RelayInnerSocket;
  private readonly handshake: NoiseIkHandshake;
  private readonly rekeyInterval: number | undefined;
  private readonly reassembler = new ChannelReassembler();
  private channel: NoiseChannel | undefined;
  private failure: { code: number; reason: string } | undefined;

  public constructor(options: RelaySecureSocketOptions) {
    this.rekeyInterval = options.rekeyInterval;
    this.handshake = NoiseIkHandshake.initiator({
      prologue: remoteChannelPrologue(options.userId, options.hostId),
      staticKeyPair: options.clientStaticKeyPair,
      remoteStaticPublicKey: options.hostKey,
      ...(options.ephemeralKeyPair === undefined
        ? {}
        : { ephemeralKeyPair: options.ephemeralKeyPair }),
    });
    const inner = options.createInnerSocket(options.url);
    this.inner = inner;
    if ('binaryType' in inner) {
      inner.binaryType = 'arraybuffer';
    }
    inner.onopen = () => this.handleInnerOpen();
    inner.onmessage = (event) => this.handleInnerMessage(event.data);
    inner.onerror = (event) => this.onerror?.(event);
    inner.onclose = (event) => this.handleInnerClose(event);
  }

  public get readyState(): number {
    return this.state;
  }

  public send(data: string): void {
    const channel = this.channel;
    if (this.state !== OPEN || channel === undefined) {
      throw new RemoteChannelError('channel-closed', 'Remote channel is not open');
    }
    this.sendMessage(channel, CHANNEL_KIND_TEXT, textEncoder.encode(data));
  }

  public close(code = 1000, reason = ''): void {
    if (this.state === CLOSING || this.state === CLOSED) {
      return;
    }
    this.state = CLOSING;
    this.channel?.close();
    this.closeInner(code, reason);
  }

  private handleInnerOpen(): void {
    if (this.state !== CONNECTING) {
      return;
    }
    try {
      // ADR 0101 §4: message 1 carries no application payload.
      this.inner.send(packRelayFrame(0, this.handshake.writeMessage()));
    } catch (error) {
      this.fail(RELAY_SECURE_SOCKET_CLOSE.handshakeFailed, describe(error, 'handshake failed'));
    }
  }

  private handleInnerMessage(data: unknown): void {
    if (this.state !== CONNECTING && this.state !== OPEN) {
      return;
    }
    const bytes = readSyncBytes(data);
    if (bytes === undefined) {
      this.failChannel('unexpected relay message');
      return;
    }
    const frame = unpackRelayFrame(bytes);
    if (frame === undefined) {
      this.failChannel('malformed relay frame');
      return;
    }
    if (this.channel === undefined) {
      this.completeHandshake(frame.payload);
      return;
    }
    try {
      const message = this.reassembler.push(this.channel.decrypt(frame.payload));
      if (message === undefined) {
        return;
      }
      this.onmessage?.({
        data:
          message.kind === CHANNEL_KIND_TEXT
            ? textDecoder.decode(message.payload)
            : message.payload,
      });
    } catch (error) {
      this.failChannel(describe(error, 'channel failed'));
    }
  }

  private completeHandshake(message: Uint8Array): void {
    try {
      const payload = this.handshake.readMessage(message);
      if (payload.length !== 0) {
        throw new RemoteChannelError('handshake-failed', 'Host sent data in the handshake');
      }
      this.channel = new NoiseChannel(
        this.handshake.split(),
        this.rekeyInterval === undefined ? {} : { rekeyInterval: this.rekeyInterval },
      );
    } catch (error) {
      this.fail(RELAY_SECURE_SOCKET_CLOSE.handshakeFailed, describe(error, 'handshake failed'));
      return;
    }
    this.state = OPEN;
    this.onopen?.();
  }

  private sendMessage(
    channel: NoiseChannel,
    kind: typeof CHANNEL_KIND_TEXT,
    payload: Uint8Array,
  ): void {
    try {
      for (const fragment of fragmentChannelMessage(kind, payload)) {
        this.inner.send(packRelayFrame(0, channel.encrypt(fragment)));
      }
    } catch (error) {
      this.failChannel(describe(error, 'send failed'));
      throw error;
    }
  }

  private handleInnerClose(event: { code: number; reason: string }): void {
    if (this.state === CLOSED) {
      return;
    }
    this.state = CLOSED;
    this.channel?.close();
    this.onclose?.(this.failure ?? event);
  }

  private failChannel(reason: string): void {
    this.fail(RELAY_SECURE_SOCKET_CLOSE.channelFailed, `Remote channel failed: ${reason}`);
  }

  /** The synthesized code wins over whatever the inner socket reports on close. */
  private fail(code: number, reason: string): void {
    if (this.failure !== undefined || this.state === CLOSED) {
      return;
    }
    this.failure = { code, reason };
    this.state = CLOSING;
    this.channel?.close();
    this.closeInner(code, reason);
  }

  private closeInner(code: number, reason: string): void {
    if (this.inner.readyState === CLOSED) {
      this.handleInnerClose({ code, reason });
      return;
    }
    try {
      this.inner.close(code, reason);
    } catch {
      this.handleInnerClose({ code, reason });
    }
  }
}

/** A `WebSocketFactory` for `WebSocketHostTransport`; the endpoint is the channel URL. */
export function createRelaySecureWebSocketFactory(
  options: Omit<RelaySecureSocketOptions, 'url'>,
): WebSocketFactory {
  return (endpoint) => new RelaySecureSocket({ ...options, url: endpoint });
}

function readSyncBytes(data: unknown): Uint8Array | undefined {
  const source = classifyBinaryFrameSource(data);
  switch (source.kind) {
    case 'bytes':
      return source.bytes;
    case 'array-buffer':
      return new Uint8Array(source.buffer);
    case 'number-array':
      return Uint8Array.from(source.values);
    default:
      // Text (the relay never sends clients text) or an async Blob, which
      // would break in-order processing.
      return undefined;
  }
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
