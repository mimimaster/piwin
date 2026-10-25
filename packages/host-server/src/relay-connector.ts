import {
  decodeRelayControlFrame,
  remoteChannelPath,
  REMOTE_CHANNEL_MAX_FRAME_BYTES,
  type RelayConnectionState,
} from '@piwin/contracts';
import { packRelayFrame, signRelayHostAuth, unpackRelayFrame } from '@piwin/host-transport';
import { WebSocket, type RawData } from 'ws';
import { ChannelPeerSession } from './channel-peer-session.js';
import type { HostIdentity } from './host-identity-store.js';
import type { HostRelayUser } from './relay-user-store.js';

export type RelayConnectorStatus = {
  state: RelayConnectionState;
  lastCloseCode?: number;
  lastError?: string;
};

export type RelayConnectorOptions = {
  url: string;
  identity: HostIdentity;
  user: HostRelayUser;
  enrollToken?: string;
  admitHandshake: (channelPublicKey: string) => boolean;
  onOpen: (peer: ChannelPeerSession) => void;
  onStatus?: (status: RelayConnectorStatus) => void;
  /** The relay admitted us; a one-time enroll token can be forgotten. */
  onReady?: () => void;
  /** Test seam. */
  createSocket?: (url: string) => WebSocket;
  minBackoffMs?: number;
  maxBackoffMs?: number;
};

const DEFAULT_MIN_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;
/** A connection that stayed up this long resets the backoff. */
const STABLE_CONNECTION_MS = 60_000;

/**
 * Dials the user's relay as this Host (ADR 0101 §7): answers the challenge
 * with Host + user signatures, then runs one channel session per client peer.
 * Reconnects with exponential backoff (1 s → 60 s) until stopped; a slow or
 * unreachable relay never blocks the local Host.
 */
export class RelayConnector {
  private readonly options: RelayConnectorOptions;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private socket: WebSocket | undefined;
  private readonly sessions = new Map<number, ChannelPeerSession>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private readyAt: number | undefined;
  private stopped = true;
  private statusValue: RelayConnectorStatus = { state: 'off' };

  public constructor(options: RelayConnectorOptions) {
    this.options = options;
    this.minBackoffMs = options.minBackoffMs ?? DEFAULT_MIN_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  public get status(): RelayConnectorStatus {
    return { ...this.statusValue };
  }

  public start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  public stop(): void {
    this.stopped = true;
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.closeSessions(1001, 'host relay stopped');
    this.socket?.close(1000, 'host stopping');
    this.socket = undefined;
    this.setStatus({ state: 'off' });
  }

  private connect(): void {
    const { identity, user } = this.options;
    const url = `${this.options.url}${remoteChannelPath(user.userId, 'host')}?hostId=${identity.hostId}`;
    this.setStatus({ ...this.statusValue, state: 'connecting' });
    const socket = (
      this.options.createSocket ??
      ((target) =>
        new WebSocket(target, {
          maxPayload: REMOTE_CHANNEL_MAX_FRAME_BYTES * 2,
        }))
    )(url);
    this.socket = socket;
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (this.socket !== socket) return;
      if (isBinary) this.routeFrame(toBytes(data));
      else this.handleControl(socket, toBytes(data).toString());
    });
    socket.on('close', (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.closeSessions(1006, 'relay connection lost');
      this.scheduleRetry(code, reason.toString());
    });
    socket.on('error', (error) => {
      if (this.socket === socket) {
        this.statusValue = { ...this.statusValue, lastError: error.message };
      }
    });
  }

  private handleControl(socket: WebSocket, text: string): void {
    const frame = decodeRelayControlFrame(text);
    switch (frame?.t) {
      case 'challenge':
        socket.send(
          JSON.stringify(
            signRelayHostAuth({
              nonce: frame.nonce,
              hostSigningSecretKey: this.options.identity.hostSigningSecretKey,
              userSecretKey: this.options.user.secretKey,
              userName: this.options.user.name,
              ...(this.options.enrollToken === undefined
                ? {}
                : { enrollToken: this.options.enrollToken }),
            }),
          ),
        );
        return;
      case 'ready':
        this.readyAt = Date.now();
        this.setStatus({ state: 'ready' });
        this.options.onReady?.();
        return;
      case 'peer-joined':
        this.openSession(socket, frame.peer);
        return;
      case 'peer-left':
        this.sessions.get(frame.peer)?.remoteClosed(1001, 'peer left');
        this.sessions.delete(frame.peer);
        return;
      default:
        // host-replaced arrives right before a 4409 close; handled there.
        return;
    }
  }

  private openSession(socket: WebSocket, peer: number): void {
    this.sessions.get(peer)?.remoteClosed(1001, 'peer replaced');
    const session = new ChannelPeerSession({
      identity: this.options.identity,
      userId: this.options.user.userId,
      link: {
        send: (noiseMessage) => {
          if (socket.readyState === socket.OPEN) socket.send(packRelayFrame(peer, noiseMessage));
        },
        close: (code, reason) => {
          this.sessions.delete(peer);
          if (socket.readyState === socket.OPEN) {
            socket.send(
              JSON.stringify({ t: 'peer-close', peer, code, reason: reason.slice(0, 100) }),
            );
          }
        },
        get bufferedAmount() {
          return socket.bufferedAmount;
        },
      },
      admitHandshake: this.options.admitHandshake,
      onOpen: this.options.onOpen,
    });
    this.sessions.set(peer, session);
  }

  private routeFrame(bytes: Uint8Array): void {
    const frame = unpackRelayFrame(bytes);
    if (frame === undefined) return;
    this.sessions.get(frame.peer)?.receive(frame.payload);
  }

  private closeSessions(code: number, reason: string): void {
    for (const session of this.sessions.values()) session.remoteClosed(code, reason);
    this.sessions.clear();
  }

  private scheduleRetry(code: number, reason: string): void {
    const stable = this.readyAt !== undefined && Date.now() - this.readyAt >= STABLE_CONNECTION_MS;
    this.readyAt = undefined;
    this.attempt = stable ? 0 : this.attempt + 1;
    if (this.stopped) return;
    this.setStatus({
      state: 'error',
      lastCloseCode: code,
      ...(reason.length > 0 ? { lastError: reason } : {}),
    });
    const delay = Math.min(
      this.maxBackoffMs,
      this.minBackoffMs * 2 ** Math.max(0, this.attempt - 1),
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.stopped) this.connect();
    }, delay);
    this.retryTimer.unref?.();
  }

  private setStatus(status: RelayConnectorStatus): void {
    this.statusValue = status;
    this.options.onStatus?.(this.status);
  }
}

function toBytes(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? Buffer.from(data) : data;
}
