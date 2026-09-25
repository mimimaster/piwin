import { randomUUID } from 'node:crypto';
import type { HostWireMessage } from '@piwin/contracts';
import { decodeHostWireMessage } from '@piwin/host-transport';
import type { WebSocket } from 'ws';
import {
  HOST_IDLE_CONNECTION_MS,
  isHostIngressBypassCommand,
  type HostConnectionEvent,
} from './host-connection-lifecycle.js';
import type { HostEgressChannel } from './host-egress-channel.js';
import {
  isLoopbackBrowserOrigin,
  requestIdFromSerializedWire,
  toError,
} from './host-server-support.js';

/** Ready state of an open socket; mirrors `ws` (this module stays DOM-free). */
export const OPEN_READY_STATE = 1;
export const CONNECTING_READY_STATE = 0;
/** A socket that never sends `client/hello` within this window is closed. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** One accepted client socket plus everything the Host tracks for it. */
export type HostClientConnection = {
  socket: WebSocket;
  authenticated: boolean;
  hydrationEnabled: boolean;
  liveSubscriptions: boolean;
  subscribedSessionIds: string[];
  handshakeTimer: ReturnType<typeof setTimeout>;
  egressClientId: string | undefined;
  egressChannel: HostEgressChannel | undefined;
  egressDetach: () => void;
  deviceId: string | undefined;
  /** Peer is this machine and no proxy relayed it; see `isDirectLoopbackRequest`. */
  directLoopback: boolean;
  idempotencyScope: string;
  connectionId: string;
  clientId: string | undefined;
  lastInboundAt: number;
  ingressTail: Promise<void>;
  /** Client declared the out-of-band binary browser-frame channel. */
  browserFrameBinary: boolean;
  /** Lease ids from this client's successful `browser/start`s; empty when idle. */
  browserMirrorLeases: Set<string>;
  /** Latest-only pending frame; a newer frame overwrites an unsent one. */
  pendingBrowserFrame: Uint8Array | undefined;
  browserFrameFlush: ReturnType<typeof setTimeout> | undefined;
};

/**
 * Absent Origin stays valid for CLI/Node clients; a browser Origin must be on
 * the configured allowlist, or loopback when no allowlist was configured.
 */
export function isAllowedHostClientOrigin(input: {
  origin: string | string[] | undefined;
  allowedOrigins: ReadonlySet<string> | undefined;
}): boolean {
  const normalized = Array.isArray(input.origin) ? input.origin[0] : input.origin;
  if (normalized === undefined || normalized.length === 0) {
    // CLI / Node / native clients often omit Origin.
    return true;
  }
  if (input.allowedOrigins !== undefined) {
    return input.allowedOrigins.has(normalized) || input.allowedOrigins.has('*');
  }
  return isLoopbackBrowserOrigin(normalized);
}

/**
 * Records a socket the Host just accepted. The handshake timer is armed here so
 * a client that never says hello cannot hold a connection slot forever.
 */
export function createHostClientConnection(options: {
  socket: WebSocket;
  /** Defaults to false: a connection must prove it is local to skip auth. */
  directLoopback?: boolean;
  onHandshakeTimeout: (connection: HostClientConnection) => void;
  handshakeTimeoutMs?: number;
}): HostClientConnection {
  const connection: HostClientConnection = {
    socket: options.socket,
    authenticated: false,
    hydrationEnabled: false,
    liveSubscriptions: false,
    subscribedSessionIds: [],
    handshakeTimer: setTimeout(() => {
      if (!connection.authenticated) {
        options.onHandshakeTimeout(connection);
      }
    }, options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS),
    egressClientId: undefined,
    egressChannel: undefined,
    egressDetach: () => undefined,
    deviceId: undefined,
    directLoopback: options.directLoopback ?? false,
    idempotencyScope: '',
    connectionId: randomUUID(),
    clientId: undefined,
    lastInboundAt: Date.now(),
    ingressTail: Promise.resolve(),
    browserFrameBinary: false,
    browserMirrorLeases: new Set(),
    pendingBrowserFrame: undefined,
    browserFrameFlush: undefined,
  };
  return connection;
}

export type HostClientSocketWiring = {
  connection: HostClientConnection;
  handleWireMessage: (connection: HostClientConnection, serialized: string) => Promise<void>;
  sendError: (
    connection: HostClientConnection,
    code: Extract<HostWireMessage, { type: 'error' }>['code'],
    message: string,
    requestId?: string,
  ) => void;
  onError: (error: Error) => void;
  /** Socket is gone: the Host releases the connection's broker/egress/leases. */
  onClose: (connection: HostClientConnection, code: number, reason: string) => void;
};

/**
 * Binds raw socket events to connection state. Accepted/closed bookkeeping —
 * the connection set, lease reaping, lifecycle events — stays with the caller.
 */
export function attachHostClientSocketWiring(wiring: HostClientSocketWiring): void {
  const { connection } = wiring;
  const { socket } = connection;
  socket.on('pong', () => {
    connection.lastInboundAt = Date.now();
  });
  socket.on('message', (data) => {
    connection.lastInboundAt = Date.now();
    const serialized = data.toString();
    // Heartbeat and turn-control must not wait behind session/list / media /
    // settings floods. Decode only enough to short-circuit; everything else
    // stays serialized.
    if (connection.authenticated) {
      try {
        const preview = decodeHostWireMessage(serialized);
        if (preview.type === 'command' && isHostIngressBypassCommand(preview.command.type)) {
          void wiring.handleWireMessage(connection, serialized).catch((error: unknown) => {
            wiring.sendError(
              connection,
              'request-failed',
              toError(error, 'Host request failed').message,
              requestIdFromSerializedWire(serialized),
            );
          });
          return;
        }
      } catch {
        // Fall through to the serialized ingress path.
      }
    }
    connection.ingressTail = connection.ingressTail
      .then(() => wiring.handleWireMessage(connection, serialized))
      .catch((error: unknown) => {
        wiring.sendError(
          connection,
          'request-failed',
          toError(error, 'Host request failed').message,
          requestIdFromSerializedWire(serialized),
        );
      });
  });
  socket.on('close', (code, reasonBuffer) => {
    wiring.onClose(connection, code, reasonBuffer.toString());
  });
  socket.on('error', (error) => wiring.onError(toError(error, 'Host client socket error')));
}

/**
 * Pings recently-active sockets and terminates ones that have been silent past
 * the idle window: a half-open TCP connection cannot be detected otherwise.
 */
export function sweepIdleHostClientConnections(input: {
  connections: Iterable<HostClientConnection>;
  onConnectionEvent: (event: HostConnectionEvent) => void;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  for (const connection of [...input.connections]) {
    if (connection.socket.readyState !== OPEN_READY_STATE) {
      continue;
    }
    if (now - connection.lastInboundAt <= HOST_IDLE_CONNECTION_MS) {
      try {
        connection.socket.ping();
      } catch {
        // Ignore ping failures; terminate path handles dead sockets.
      }
      continue;
    }
    input.onConnectionEvent({
      phase: 'idle-terminate',
      connectionId: connection.connectionId,
      ...(connection.clientId === undefined ? {} : { clientId: connection.clientId }),
      reason: 'idle',
    });
    try {
      connection.socket.terminate();
    } catch {
      // Best-effort.
    }
  }
}
