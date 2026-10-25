import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { DisconnectedMirrorLeaseReaper } from './browser-mirror-leases.js';
import {
  attachHostClientSocketWiring,
  createHostClientConnection,
  isAllowedHostClientOrigin,
  type HostClientConnection,
} from './host-client-connection.js';
import type { HostConnectionEvent } from './host-connection-lifecycle.js';
import { isDirectLoopbackRequest } from './host-connection-origin.js';
import type { HostConnectionSender } from './host-connection-send.js';
import type { DeviceToolBroker } from './device-tool-broker.js';
import { wrapWsPeerSocket, type HostPeerSocket } from './host-peer-socket.js';

/** Server state an accepted socket joins; supplied by HostServer. */
export type HostConnectionAcceptHost = {
  connections: Set<HostClientConnection>;
  allowedOrigins: ReadonlySet<string> | undefined;
  sender: Pick<HostConnectionSender, 'sendError'>;
  clientToolBroker: DeviceToolBroker | undefined;
  mirrorLeaseReaper: DisconnectedMirrorLeaseReaper;
  handleWireMessage: (connection: HostClientConnection, serialized: string) => Promise<void>;
  onError: (error: Error) => void;
  onConnectionEvent: (event: HostConnectionEvent) => void;
};

/**
 * Admits one upgraded socket into the server: Origin gate, connection record
 * with a handshake deadline, and the close path that releases broker, egress
 * and browser-mirror leases.
 */
export function acceptHostSocket(
  host: HostConnectionAcceptHost,
  socket: WebSocket,
  request: IncomingMessage,
): void {
  if (
    !isAllowedHostClientOrigin({
      origin: request.headers.origin,
      allowedOrigins: host.allowedOrigins,
    })
  ) {
    host.onConnectionEvent({
      phase: 'hello-reject',
      connectionId: 'pre-hello',
      code: 4009,
      reason: 'Origin not allowed',
    });
    socket.close(4009, 'Origin not allowed');
    return;
  }
  acceptHostPeer(host, wrapWsPeerSocket(socket), {
    directLoopback: isDirectLoopbackRequest(request),
  });
}

/**
 * Joins any peer socket to the server: a `ws` socket from `acceptHostSocket`
 * or an ADR 0101 channel peer (never loopback; carries its channel key).
 */
export function acceptHostPeer(
  host: HostConnectionAcceptHost,
  socket: HostPeerSocket,
  options: { directLoopback: boolean; channelPublicKey?: string },
): void {
  const connection = createHostClientConnection({
    socket,
    directLoopback: options.directLoopback,
    ...(options.channelPublicKey === undefined
      ? {}
      : { channelPublicKey: options.channelPublicKey }),
    onHandshakeTimeout: (pending) => {
      host.sender.sendError(pending, 'authentication-required', 'Host hello is required');
      socket.close(4001, 'Host hello required');
    },
  });
  host.connections.add(connection);
  host.onConnectionEvent({ phase: 'accept', connectionId: connection.connectionId });
  attachHostClientSocketWiring({
    connection,
    handleWireMessage: host.handleWireMessage,
    sendError: (target, code, message, requestId) =>
      host.sender.sendError(target, code, message, requestId),
    onError: host.onError,
    onClose: (closed, code, reason) => {
      clearTimeout(closed.handshakeTimer);
      host.clientToolBroker?.detach(closed.connectionId);
      closed.egressDetach();
      host.connections.delete(closed);
      host.mirrorLeaseReaper.schedule(closed.browserMirrorLeases);
      host.onConnectionEvent({
        phase: 'close',
        connectionId: closed.connectionId,
        ...(closed.clientId === undefined ? {} : { clientId: closed.clientId }),
        ...(closed.deviceId === undefined ? {} : { deviceId: closed.deviceId }),
        code,
        reason,
      });
    },
  });
}
