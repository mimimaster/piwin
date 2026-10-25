import {
  CHANNEL_KIND_BINARY,
  CHANNEL_KIND_TEXT,
  ChannelReassembler,
  encodeBase64Url,
  fragmentChannelMessage,
  NoiseChannel,
  NoiseIkHandshake,
  remoteChannelPrologue,
  RemoteChannelError,
} from '@piwin/host-transport';
import { REMOTE_CHANNEL_CLOSE } from '@piwin/contracts';
import type { HostIdentity } from './host-identity-store.js';
import type { HostPeerSocket } from './host-peer-socket.js';

/**
 * One client's slice of a transport: the relay socket addressed to one peer
 * id, or a whole direct WebSocket. `send` takes one Noise message; the link
 * adds the relay envelope.
 */
export type ChannelFrameLink = {
  send(noiseMessage: Uint8Array): void;
  close(code: number, reason: string): void;
  readonly bufferedAmount: number;
};

export type ChannelPeerSessionOptions = {
  identity: HostIdentity;
  userId: string;
  link: ChannelFrameLink;
  /**
   * ADR 0101 §5.3 early drop: called with the client's static key after
   * message 1. False closes the link without answering.
   */
  admitHandshake: (channelPublicKey: string) => boolean;
  /** The handshake completed; hand the peer to the Host server. */
  onOpen: (peer: ChannelPeerSession) => void;
  rekeyInterval?: number;
};

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;
/** A broken channel: the client reconnects with a fresh handshake. */
const CHANNEL_FAILED_CLOSE = 4007;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const textEncoder = new TextEncoder();

/**
 * Host end of the ADR 0101 channel: Noise IK responder, then a
 * `HostPeerSocket` so the connection joins HostServer admission, replay and
 * egress like any other socket.
 *
 * `ping()` is a no-op: a relay peer cannot be pinged end to end, and the
 * client's 30 s heartbeat keeps `lastInboundAt` fresh well inside the 90 s
 * idle window.
 */
export class ChannelPeerSession implements HostPeerSocket {
  private readonly options: ChannelPeerSessionOptions;
  private readonly handshake: NoiseIkHandshake;
  private readonly reassembler = new ChannelReassembler();
  private channel: NoiseChannel | undefined;
  private state: number = CONNECTING;
  private remoteKey: string | undefined;
  private readonly messageListeners: Array<(text: string) => void> = [];
  private readonly closeListeners: Array<(code: number, reason: string) => void> = [];
  private readonly errorListeners: Array<(error: unknown) => void> = [];

  public constructor(options: ChannelPeerSessionOptions) {
    this.options = options;
    this.handshake = NoiseIkHandshake.responder({
      prologue: remoteChannelPrologue(options.userId, options.identity.hostId),
      staticKeyPair: options.identity.staticKeyPair,
    });
  }

  /** The key the client proved in its handshake; set before `onOpen`. */
  public get channelPublicKey(): string | undefined {
    return this.remoteKey;
  }

  public get readyState(): number {
    return this.state;
  }

  public get bufferedAmount(): number {
    return this.options.link.bufferedAmount;
  }

  /** One Noise message from the link, in arrival order. */
  public receive(noiseMessage: Uint8Array): void {
    if (this.state === CLOSED) {
      return;
    }
    if (this.channel === undefined) {
      this.respondToHandshake(noiseMessage);
      return;
    }
    try {
      const message = this.reassembler.push(this.channel.decrypt(noiseMessage));
      if (message === undefined) {
        return;
      }
      if (message.kind !== CHANNEL_KIND_TEXT) {
        throw new RemoteChannelError('frame-invalid', 'Clients send text messages only');
      }
      const text = textDecoder.decode(message.payload);
      for (const listener of this.messageListeners) listener(text);
    } catch (error) {
      this.fail(error);
    }
  }

  /** The link is gone (relay `peer-left`, socket closed). */
  public remoteClosed(code: number, reason: string): void {
    this.finish(code, reason);
  }

  public send(data: string | Uint8Array): void {
    const channel = this.channel;
    if (this.state !== OPEN || channel === undefined) {
      throw new RemoteChannelError('channel-closed', 'Channel is not open');
    }
    const kind = typeof data === 'string' ? CHANNEL_KIND_TEXT : CHANNEL_KIND_BINARY;
    const payload = typeof data === 'string' ? textEncoder.encode(data) : data;
    try {
      for (const fragment of fragmentChannelMessage(kind, payload)) {
        this.options.link.send(channel.encrypt(fragment));
      }
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  public close(code: number, reason: string): void {
    if (this.state === CLOSED) {
      return;
    }
    this.options.link.close(code, reason);
    this.finish(code, reason);
  }

  public terminate(): void {
    this.close(CHANNEL_FAILED_CLOSE, 'terminated');
  }

  public ping(): void {
    // See the class comment: liveness comes from the client heartbeat.
  }

  public onMessage(listener: (text: string) => void): void {
    this.messageListeners.push(listener);
  }

  public onPong(): void {
    // Never fires; see ping().
  }

  public onClose(listener: (code: number, reason: string) => void): void {
    this.closeListeners.push(listener);
  }

  public onError(listener: (error: unknown) => void): void {
    this.errorListeners.push(listener);
  }

  private respondToHandshake(message: Uint8Array): void {
    let reply: Uint8Array;
    try {
      if (this.handshake.readMessage(message).length !== 0) {
        throw new RemoteChannelError('handshake-failed', 'Message 1 must not carry data');
      }
      const remote = this.handshake.remoteStaticPublicKey;
      if (remote === undefined) {
        throw new RemoteChannelError('handshake-failed', 'No client static key');
      }
      this.remoteKey = encodeBase64Url(remote);
      if (!this.options.admitHandshake(this.remoteKey)) {
        // Same answer as an offline Host: nothing to learn from probing.
        this.close(REMOTE_CHANNEL_CLOSE.unavailable, 'unavailable');
        return;
      }
      reply = this.handshake.writeMessage();
      this.channel = new NoiseChannel(
        this.handshake.split(),
        this.options.rekeyInterval === undefined
          ? {}
          : { rekeyInterval: this.options.rekeyInterval },
      );
    } catch (error) {
      this.fail(error);
      return;
    }
    this.options.link.send(reply);
    this.state = OPEN;
    this.options.onOpen(this);
  }

  private fail(error: unknown): void {
    for (const listener of this.errorListeners) listener(error);
    const reason = error instanceof Error ? error.message : 'channel failed';
    this.close(CHANNEL_FAILED_CLOSE, reason.slice(0, 100));
  }

  private finish(code: number, reason: string): void {
    if (this.state === CLOSED) {
      return;
    }
    this.state = CLOSED;
    this.channel?.close();
    for (const listener of this.closeListeners) listener(code, reason);
  }
}
