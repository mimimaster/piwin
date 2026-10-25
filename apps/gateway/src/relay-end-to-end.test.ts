import {
  ChannelReassembler,
  CHANNEL_KIND_TEXT,
  createRelaySecureWebSocketFactory,
  fragmentChannelMessage,
  generateNoiseKeyPair,
  NoiseChannel,
  NoiseIkHandshake,
  packRelayFrame,
  remoteChannelPrologue,
  unpackRelayFrame,
  WebSocketHostTransport,
  encodeHostWireMessage,
  decodeHostWireMessage,
  type RelayInnerSocket,
} from '@piwin/host-transport';
import type { HostHello } from '@piwin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  connectReadyHost,
  connectUrl,
  createTestIdentity,
  startTestRelay,
  waitFor,
  type TestRelay,
} from './relay-harness.fixture.js';

const relays: TestRelay[] = [];
afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.close();
});

const SECRET_MARKER = 'top-secret-prompt-7f3a';

describe('end to end through the relay', () => {
  it('runs the Host hello over Noise and the relay never sees plaintext', async () => {
    const identity = createTestIdentity();
    const relay = await startTestRelay({ registered: [identity] });
    relays.push(relay);
    const host = await connectReadyHost(relay.url, identity);

    // A Host-side channel endpoint built from the same primitives P3 will use.
    const hostStatic = generateNoiseKeyPair();
    const relayedBytes: Uint8Array[] = [];
    const sessions = new Map<
      number,
      { handshake: NoiseIkHandshake; channel?: NoiseChannel; reassembler: ChannelReassembler }
    >();
    host.socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      const bytes = new Uint8Array(data);
      relayedBytes.push(bytes);
      const frame = unpackRelayFrame(bytes);
      if (frame === undefined) throw new Error('bad frame');
      let session = sessions.get(frame.peer);
      if (session === undefined) {
        session = {
          handshake: NoiseIkHandshake.responder({
            prologue: remoteChannelPrologue(identity.userId, identity.hostId),
            staticKeyPair: hostStatic,
          }),
          reassembler: new ChannelReassembler(),
        };
        sessions.set(frame.peer, session);
      }
      if (session.channel === undefined) {
        session.handshake.readMessage(frame.payload);
        const reply = session.handshake.writeMessage();
        session.channel = new NoiseChannel(session.handshake.split());
        host.socket.send(packRelayFrame(frame.peer, reply));
        return;
      }
      const message = session.reassembler.push(session.channel.decrypt(frame.payload));
      if (message === undefined) return;
      const wire = decodeHostWireMessage(new TextDecoder().decode(message.payload));
      if (wire.type !== 'client/hello') return;
      const hello: HostHello = {
        type: 'host/hello',
        protocolVersion: 1,
        hostInstanceId: SECRET_MARKER,
        currentSeq: 0,
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
      for (const fragment of fragmentChannelMessage(
        CHANNEL_KIND_TEXT,
        new TextEncoder().encode(encodeHostWireMessage(hello)),
      )) {
        host.socket.send(packRelayFrame(frame.peer, session.channel.encrypt(fragment)));
      }
    });

    const transport = new WebSocketHostTransport({
      endpoint: connectUrl(relay.url, identity),
      autoReconnect: false,
      webSocketFactory: createRelaySecureWebSocketFactory({
        userId: identity.userId,
        hostId: identity.hostId,
        hostKey: hostStatic.publicKey,
        clientStaticKeyPair: generateNoiseKeyPair(),
        createInnerSocket: (url) => new WebSocket(url) as unknown as RelayInnerSocket,
      }),
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: SECRET_MARKER,
        clientId: 'client-1',
        lastSeq,
      }),
    });

    const hello = await transport.connect();
    expect(hello.hostInstanceId).toBe(SECRET_MARKER);
    await waitFor(() => (relayedBytes.length >= 2 ? true : undefined));
    const seenByRelay = Buffer.concat(relayedBytes).toString('latin1');
    expect(seenByRelay).not.toContain(SECRET_MARKER);
    expect(seenByRelay).not.toContain('client/hello');
    await transport.close();
  });
});
