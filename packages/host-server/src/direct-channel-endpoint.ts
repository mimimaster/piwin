import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  parseRemoteChannelPath,
  REMOTE_CHANNEL_CLOSE,
  REMOTE_CHANNEL_MAX_FRAME_BYTES,
} from '@piwin/contracts';
import { packRelayFrame, unpackRelayFrame } from '@piwin/host-transport';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { ChannelPeerSession } from './channel-peer-session.js';
import type { HostIdentity } from './host-identity-store.js';
import type { HostChannelUpgradeHandler } from './host-server-listener.js';

/** Direct frames still carry the 4-byte peer prefix; the Host ignores it and sends 1. */
const DIRECT_PEER_ID = 1;

export type DirectChannelEndpointOptions = {
  /** Undefined while this Host has no relay user yet (channel not set up). */
  ids: () => { identity: HostIdentity; userId: string } | undefined;
  admitHandshake: (channelPublicKey: string) => boolean;
  onOpen: (peer: ChannelPeerSession) => void;
};

/**
 * ADR 0101 §7: the Host's own `/v1/u/<userId>/connect?hostId=…`. Same
 * envelope and channel as the relay, for exactly one Host, so shells use the
 * same client code on both paths. Unknown ids close with the ambiguous 4404.
 */
export function createDirectChannelUpgradeHandler(options: DirectChannelEndpointOptions): {
  handler: HostChannelUpgradeHandler;
  close: () => void;
} {
  const wsServer = new WebSocketServer({
    noServer: true,
    maxPayload: REMOTE_CHANNEL_MAX_FRAME_BYTES * 2,
  });

  const handler: HostChannelUpgradeHandler = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      const ids = options.ids();
      const url = new URL(request.url ?? '/', 'http://host');
      const path = parseRemoteChannelPath(url.pathname);
      if (
        ids === undefined ||
        path?.route !== 'connect' ||
        path.userId !== ids.userId ||
        url.searchParams.get('hostId') !== ids.identity.hostId
      ) {
        webSocket.close(REMOTE_CHANNEL_CLOSE.unavailable, 'unavailable');
        return;
      }
      bindDirectSocket(webSocket, ids, options);
    });
  };

  return {
    handler,
    close: () => {
      for (const client of wsServer.clients) client.terminate();
      wsServer.close();
    },
  };
}

function bindDirectSocket(
  webSocket: WebSocket,
  ids: { identity: HostIdentity; userId: string },
  options: DirectChannelEndpointOptions,
): void {
  const session = new ChannelPeerSession({
    identity: ids.identity,
    userId: ids.userId,
    link: {
      send: (noiseMessage) => webSocket.send(packRelayFrame(DIRECT_PEER_ID, noiseMessage)),
      close: (code, reason) => webSocket.close(code, reason),
      get bufferedAmount() {
        return webSocket.bufferedAmount;
      },
    },
    admitHandshake: options.admitHandshake,
    onOpen: options.onOpen,
  });
  webSocket.on('message', (data: RawData, isBinary: boolean) => {
    const bytes = isBinary ? toBytes(data) : undefined;
    const frame = bytes === undefined ? undefined : unpackRelayFrame(bytes);
    if (frame === undefined) {
      webSocket.close(REMOTE_CHANNEL_CLOSE.badRequest, 'invalid frame');
      return;
    }
    session.receive(frame.payload);
  });
  webSocket.on('close', (code, reason) => session.remoteClosed(code, reason.toString()));
  webSocket.on('error', () => webSocket.terminate());
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}
