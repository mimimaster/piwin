import { describe, expect, it, vi } from 'vitest';
import type { HostHello, HostWireMessage } from '@piwin/contracts';
import { decodeHostWireMessage, encodeHostWireMessage } from '../protocol-codec.js';
import { HostHandshakeError } from '../host-handshake-error.js';
import { WebSocketHostTransport } from '../websocket-host-transport.js';
import {
  CHANNEL_KIND_BINARY,
  CHANNEL_KIND_TEXT,
  ChannelReassembler,
  fragmentChannelMessage,
  type ChannelMessageKind,
} from './channel-fragment.js';
import { NoiseChannel } from './noise/noise-channel.js';
import {
  generateNoiseKeyPair,
  NoiseIkHandshake,
  type NoiseKeyPair,
} from './noise/noise-ik-handshake.js';
import { packRelayFrame, unpackRelayFrame } from './relay-envelope.js';
import { remoteChannelPrologue } from './remote-identity.js';
import {
  createRelaySecureWebSocketFactory,
  RELAY_SECURE_SOCKET_CLOSE,
  RelaySecureSocket,
  type RelayInnerSocket,
} from './relay-secure-socket.js';

const USER_ID = 'AbCdEfGhIjKlMnOpQrSt_-';
const HOST_ID = 'ZyXwVuTsRqPoNmLkJiHg-_';
const URL = `wss://relay.test/v1/u/${USER_ID}/connect?hostId=${HOST_ID}`;

/** In-memory relay socket; frames to the Host go through `onSend`. */
class FakeInnerSocket implements RelayInnerSocket {
  public readyState = 0;
  public binaryType = 'blob';
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public readonly sent: Uint8Array[] = [];
  public readonly closeCalls: Array<{ code: number | undefined; reason: string | undefined }> = [];
  public onSend: ((frame: Uint8Array) => void) | undefined;

  public constructor(public readonly url: string) {}

  public send(data: string | Uint8Array): void {
    if (typeof data === 'string') throw new Error('channel must send binary');
    this.sent.push(data);
    this.onSend?.(data);
  }

  public close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code: code ?? 1000, reason: reason ?? '' }));
  }

  public open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  public deliver(frame: Uint8Array): void {
    // ArrayBuffer, as a browser socket with binaryType 'arraybuffer' would.
    this.onmessage?.({ data: frame.slice().buffer });
  }
}

/** The Host side of the channel, built from the same primitives the Host will use. */
class FakeHost {
  public channel: NoiseChannel | undefined;
  public clientStatic: Uint8Array | undefined;
  public readonly received: Array<{ kind: ChannelMessageKind; payload: Uint8Array }> = [];
  public handshakePayload = new Uint8Array(0);
  private readonly reassembler = new ChannelReassembler();
  private readonly handshake: NoiseIkHandshake;

  public constructor(
    private readonly inner: FakeInnerSocket,
    hostStatic: NoiseKeyPair,
  ) {
    this.handshake = NoiseIkHandshake.responder({
      prologue: remoteChannelPrologue(USER_ID, HOST_ID),
      staticKeyPair: hostStatic,
    });
    inner.onSend = (frame) => this.receive(frame);
  }

  public sendText(text: string): void {
    this.sendKind(CHANNEL_KIND_TEXT, new TextEncoder().encode(text));
  }

  public sendKind(kind: ChannelMessageKind, payload: Uint8Array): void {
    const channel = this.requireChannel();
    for (const fragment of fragmentChannelMessage(kind, payload)) {
      this.inner.deliver(packRelayFrame(1, channel.encrypt(fragment)));
    }
  }

  public requireChannel(): NoiseChannel {
    if (this.channel === undefined) throw new Error('handshake not complete');
    return this.channel;
  }

  private receive(frame: Uint8Array): void {
    const unpacked = unpackRelayFrame(frame);
    if (unpacked === undefined) throw new Error('bad frame from client');
    if (this.channel === undefined) {
      expect(unpacked.peer).toBe(0);
      expect(this.handshake.readMessage(unpacked.payload)).toEqual(new Uint8Array(0));
      this.clientStatic = this.handshake.remoteStaticPublicKey;
      const reply = this.handshake.writeMessage(this.handshakePayload);
      this.channel = new NoiseChannel(this.handshake.split());
      queueMicrotask(() => this.inner.deliver(packRelayFrame(1, reply)));
      return;
    }
    const message = this.reassembler.push(this.channel.decrypt(unpacked.payload));
    if (message !== undefined) this.received.push(message);
  }
}

/** A socket whose Host answers with `hostStatic`; the client pins `pinnedHostKey` (default: the real one). */
function setup(options: { pinnedHostKey?: Uint8Array } = {}) {
  const hostStatic = generateNoiseKeyPair();
  const clientStatic = generateNoiseKeyPair();
  let inner: FakeInnerSocket | undefined;
  let host: FakeHost | undefined;
  const socket = new RelaySecureSocket({
    url: URL,
    userId: USER_ID,
    hostId: HOST_ID,
    hostKey: options.pinnedHostKey ?? hostStatic.publicKey,
    clientStaticKeyPair: clientStatic,
    createInnerSocket: (url) => {
      inner = new FakeInnerSocket(url);
      host = new FakeHost(inner, hostStatic);
      return inner;
    },
  });
  if (inner === undefined || host === undefined) throw new Error('inner socket not created');
  return { socket, inner, host, clientStatic };
}

async function openChannel(fixture: {
  socket: RelaySecureSocket;
  inner: FakeInnerSocket;
}): Promise<void> {
  const opened = new Promise<void>((resolve) => {
    fixture.socket.onopen = () => resolve();
  });
  fixture.inner.open();
  await opened;
}

function nextClose(socket: RelaySecureSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.onclose = (event) => resolve(event);
  });
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('RelaySecureSocket', () => {
  it('dials the channel URL with arraybuffer binary and opens only after the handshake', async () => {
    const fixture = setup();
    expect(fixture.inner.url).toBe(URL);
    expect(fixture.inner.binaryType).toBe('arraybuffer');
    expect(fixture.socket.readyState).toBe(0);
    const opened = vi.fn();
    fixture.socket.onopen = opened;
    fixture.inner.open();
    expect(opened).not.toHaveBeenCalled();
    expect(fixture.socket.readyState).toBe(0);
    await flush();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(fixture.socket.readyState).toBe(1);
    expect(fixture.host.clientStatic).toEqual(fixture.clientStatic.publicKey);
  });

  it('sends message 1 without payload and stamps every client frame with peer 0', async () => {
    const fixture = setup();
    await openChannel(fixture);
    fixture.socket.send('{"type":"ping"}');
    expect(fixture.inner.sent[0]).toHaveLength(4 + 96);
    for (const frame of fixture.inner.sent) {
      expect(unpackRelayFrame(frame)?.peer).toBe(0);
    }
  });

  it('carries text both ways, including multi-fragment and non-ASCII messages', async () => {
    const fixture = setup();
    await openChannel(fixture);
    const big = `{"text":"${'界'.repeat(40_000)}"}`;
    fixture.socket.send(big);
    expect(new TextDecoder().decode(fixture.host.received[0]?.payload)).toBe(big);
    expect(fixture.inner.sent.length).toBeGreaterThan(2);

    const received: unknown[] = [];
    fixture.socket.onmessage = (event) => received.push(event.data);
    fixture.host.sendText(big);
    fixture.host.sendText('{"ok":true}');
    expect(received).toEqual([big, '{"ok":true}']);
  });

  it('surfaces Host binary messages as bytes', async () => {
    const fixture = setup();
    await openChannel(fixture);
    const received: unknown[] = [];
    fixture.socket.onmessage = (event) => received.push(event.data);
    fixture.host.sendKind(CHANNEL_KIND_BINARY, Uint8Array.of(0xff, 0xd8, 0xff));
    expect(received).toEqual([Uint8Array.of(0xff, 0xd8, 0xff)]);
  });

  it('closes with the handshake code when the Host key does not match the pinned one', async () => {
    // The client pinned another key, so whoever answers is not the Host it
    // paired with: an impostor cannot read message 1 and can only send noise.
    const fixture = setup({ pinnedHostKey: generateNoiseKeyPair().publicKey });
    fixture.inner.onSend = () => {
      queueMicrotask(() => fixture.inner.deliver(packRelayFrame(1, new Uint8Array(48))));
    };
    const opened = vi.fn();
    fixture.socket.onopen = opened;
    const closed = nextClose(fixture.socket);
    fixture.inner.open();
    expect(await closed).toMatchObject({ code: RELAY_SECURE_SOCKET_CLOSE.handshakeFailed });
    expect(opened).not.toHaveBeenCalled();
    expect(fixture.socket.readyState).toBe(3);
  });

  it('rejects a handshake reply that carries data', async () => {
    const fixture = setup();
    fixture.host.handshakePayload = Uint8Array.of(1);
    const closed = nextClose(fixture.socket);
    fixture.inner.open();
    expect(await closed).toMatchObject({ code: RELAY_SECURE_SOCKET_CLOSE.handshakeFailed });
  });

  it('closes with the channel code on a tampered transport frame', async () => {
    const fixture = setup();
    await openChannel(fixture);
    const closed = nextClose(fixture.socket);
    const ciphertext = fixture.host
      .requireChannel()
      .encrypt(fragmentChannelMessage(CHANNEL_KIND_TEXT, Uint8Array.of(1))[0] ?? new Uint8Array());
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    fixture.inner.deliver(packRelayFrame(1, ciphertext));
    expect(await closed).toMatchObject({ code: RELAY_SECURE_SOCKET_CLOSE.channelFailed });
    expect(() => fixture.socket.send('{}')).toThrow();
  });

  it('treats relay text and async blobs as a broken channel', async () => {
    const textFixture = setup();
    await openChannel(textFixture);
    const textClosed = nextClose(textFixture.socket);
    textFixture.inner.onmessage?.({ data: '{"t":"peer-joined","peer":1}' });
    expect(await textClosed).toMatchObject({ code: RELAY_SECURE_SOCKET_CLOSE.channelFailed });

    const blobFixture = setup();
    await openChannel(blobFixture);
    const blobClosed = nextClose(blobFixture.socket);
    blobFixture.inner.onmessage?.({ data: { arrayBuffer: async () => new ArrayBuffer(8) } });
    expect(await blobClosed).toMatchObject({ code: RELAY_SECURE_SOCKET_CLOSE.channelFailed });
  });

  it('passes relay close codes through before the handshake', async () => {
    const fixture = setup();
    const closed = nextClose(fixture.socket);
    fixture.inner.readyState = 3;
    fixture.inner.onclose?.({ code: 4404, reason: 'unavailable' });
    expect(await closed).toEqual({ code: 4404, reason: 'unavailable' });
  });

  it('closes the inner socket once and reports close once', async () => {
    const fixture = setup();
    await openChannel(fixture);
    const onclose = vi.fn();
    fixture.socket.onclose = onclose;
    fixture.socket.close(1000, 'bye');
    fixture.socket.close(1000, 'again');
    expect(fixture.socket.readyState).toBe(2);
    await flush();
    expect(fixture.inner.closeCalls).toEqual([{ code: 1000, reason: 'bye' }]);
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(fixture.socket.readyState).toBe(3);
  });

  it('refuses to send before the channel is open', () => {
    const fixture = setup();
    expect(() => fixture.socket.send('{}')).toThrow();
  });
});

describe('WebSocketHostTransport over RelaySecureSocket', () => {
  it('completes the Host hello through the encrypted channel', async () => {
    const hostStatic = generateNoiseKeyPair();
    let host: FakeHost | undefined;
    let inner: FakeInnerSocket | undefined;
    const factory = createRelaySecureWebSocketFactory({
      userId: USER_ID,
      hostId: HOST_ID,
      hostKey: hostStatic.publicKey,
      clientStaticKeyPair: generateNoiseKeyPair(),
      createInnerSocket: (url) => {
        inner = new FakeInnerSocket(url);
        host = new FakeHost(inner, hostStatic);
        queueMicrotask(() => inner?.open());
        return inner;
      },
    });
    const transport = new WebSocketHostTransport({
      endpoint: URL,
      webSocketFactory: factory,
      autoReconnect: false,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'client-1',
        lastSeq,
      }),
    });
    const connection = transport.connect();
    const hello: HostHello = {
      type: 'host/hello',
      protocolVersion: 1,
      hostInstanceId: 'host-1',
      currentSeq: 3,
      authRequired: false,
      authenticated: true,
      capabilities: {
        pushSequencing: true,
        replay: true,
        snapshot: true,
        sessionRead: true,
        sessionControl: false,
        permissionResolve: false,
        mediaUpload: false,
      },
    };
    await vi.waitFor(() => expect(host?.received.length).toBe(1));
    const clientHello = decodeHostWireMessage(new TextDecoder().decode(host?.received[0]?.payload));
    expect(clientHello).toMatchObject({ type: 'client/hello', clientId: 'client-1' });
    host?.sendText(encodeHostWireMessage(hello as HostWireMessage));
    await expect(connection).resolves.toEqual(hello);
    await transport.close();
  });

  it('does not retry after a pinned-key handshake failure', async () => {
    let dials = 0;
    const factory = createRelaySecureWebSocketFactory({
      userId: USER_ID,
      hostId: HOST_ID,
      hostKey: generateNoiseKeyPair().publicKey,
      clientStaticKeyPair: generateNoiseKeyPair(),
      createInnerSocket: (url) => {
        dials += 1;
        const inner = new FakeInnerSocket(url);
        inner.onSend = () =>
          queueMicrotask(() => inner.deliver(packRelayFrame(1, new Uint8Array(48))));
        queueMicrotask(() => inner.open());
        return inner;
      },
    });
    const transport = new WebSocketHostTransport({
      endpoint: URL,
      webSocketFactory: factory,
      autoReconnect: true,
      reconnectMinDelayMs: 1,
      reconnectMaxDelayMs: 1,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'client-1',
        lastSeq,
      }),
    });
    await expect(transport.connect()).rejects.toBeInstanceOf(HostHandshakeError);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dials).toBe(1);
    await transport.close();
  });
});
