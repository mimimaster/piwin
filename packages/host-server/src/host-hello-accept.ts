import { randomUUID } from 'node:crypto';
import type { HostHello, HostWireMessage, RemoteCapabilitySummary } from '@piwin/contracts';
import { HOST_PROTOCOL_VERSION, LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';
import type { LiveSessionFilter } from '@piwin/host-transport';
import type { DeviceToolBroker } from './device-tool-broker.js';
import type { HostDevicePairing } from './device-pairing.js';
import type { HostDevicePairingFileStore } from './device-pairing-store.js';
import type { HostEgressHub } from './host-egress-hub.js';
import {
  HOST_SOCKET_SEND_BUDGET_BYTES,
  compareClientVersions,
  type HostConnectionEvent,
} from './host-connection-lifecycle.js';
import { OPEN_READY_STATE, type HostClientConnection } from './host-client-connection.js';
import { authenticateHostHello } from './host-hello-auth.js';
import { replayHostConnection, type HostHydrationHost } from './host-server-hydration.js';
import {
  authTokensEqual,
  isLoopbackHost,
  normalizeHydrationSessionIds,
  normalizeSeq,
  toError,
} from './host-server-support.js';
import { isLiveOwnerConnection } from './live-remote-gate.js';

/**
 * The server state one hello needs. Passing it explicitly keeps this module
 * free of the Host class while still letting it read live config (auth token,
 * device pairing, egress hub) rather than a snapshot taken at construction.
 */
export type HostHelloAcceptHost = {
  host: string;
  instanceId: string;
  authToken: string | undefined;
  minClientVersion: string | undefined;
  hostBuildId: string | undefined;
  capabilities: RemoteCapabilitySummary;
  devicePairing: HostDevicePairing | undefined;
  devicePairingStore: HostDevicePairingFileStore | undefined;
  egressHub: HostEgressHub;
  clientToolBroker: DeviceToolBroker | undefined;
  onError: (error: Error) => void;
  onConnectionEvent: (event: HostConnectionEvent) => void;
  send: (connection: HostClientConnection, message: HostWireMessage) => void;
  sendError: (
    connection: HostClientConnection,
    code: Extract<HostWireMessage, { type: 'error' }>['code'],
    message: string,
    requestId?: string,
  ) => void;
  projectOutboundPush: (
    frame: Extract<HostWireMessage, { type: 'push' }>,
    connection?: HostClientConnection,
  ) => Extract<HostWireMessage, { type: 'push' }>;
  projectOutboundBatch: (
    frame: Extract<HostWireMessage, { type: 'push/batch' }>,
    connection?: HostClientConnection,
  ) => Extract<HostWireMessage, { type: 'push/batch' }>;
  hydrationHost: (connection: HostClientConnection) => HostHydrationHost;
};

export function createHostHelloPayload(
  host: HostHelloAcceptHost,
  deviceId?: string,
  deviceSecret?: string,
): HostHello {
  return {
    type: 'host/hello',
    protocolVersion: HOST_PROTOCOL_VERSION,
    hostInstanceId: host.instanceId,
    currentSeq: host.egressHub.getCurrentSeq(),
    authRequired: host.authToken !== undefined || host.devicePairing !== undefined,
    authenticated: true,
    capabilities: host.capabilities,
    ...(host.hostBuildId === undefined ? {} : { hostBuildId: host.hostBuildId }),
    ...(host.minClientVersion === undefined ? {} : { minClientVersion: host.minClientVersion }),
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(deviceSecret === undefined ? {} : { deviceSecret }),
  };
}

/**
 * Authenticates an unauthenticated connection and promotes it to a live client:
 * hello gates, credential check, egress subscription, client-tool attach, then
 * the opening replay. A rejection closes the socket and never mutates state.
 */
export async function acceptHostHello(
  host: HostHelloAcceptHost,
  connection: HostClientConnection,
  message: Extract<HostWireMessage, { type: 'client/hello' }>,
): Promise<void> {
  if (message.protocolVersion !== HOST_PROTOCOL_VERSION) {
    host.onConnectionEvent({
      phase: 'hello-reject',
      connectionId: connection.connectionId,
      code: 4002,
      reason: 'protocol-mismatch',
    });
    host.sendError(connection, 'protocol-mismatch', 'Unsupported Host protocol version');
    connection.socket.close(4002, 'Protocol mismatch');
    return;
  }
  if (
    host.minClientVersion !== undefined &&
    compareClientVersions(message.clientVersion, host.minClientVersion) < 0
  ) {
    host.onConnectionEvent({
      phase: 'hello-reject',
      connectionId: connection.connectionId,
      code: 4002,
      reason: 'client-version-too-old',
    });
    host.sendError(
      connection,
      'protocol-mismatch',
      `Client version ${message.clientVersion} is older than required ${host.minClientVersion}`,
    );
    connection.socket.close(4002, 'Client version too old');
    return;
  }
  if (message.clientId.trim().length === 0) {
    host.onConnectionEvent({
      phase: 'hello-reject',
      connectionId: connection.connectionId,
      code: 4003,
      reason: 'invalid-client-id',
    });
    host.sendError(connection, 'bad-message', 'clientId is required');
    connection.socket.close(4003, 'Invalid client ID');
    return;
  }

  const admission = await authenticateHostHello(message, {
    authToken: host.authToken,
    devicePairing: host.devicePairing,
    allowAnonymousHello: host.authToken === undefined && isLoopbackHost(host.host),
    persistEnrollment: async (pairing) => {
      if (host.devicePairingStore !== undefined) {
        await host.devicePairingStore.save(pairing);
      }
    },
    tokensEqual: authTokensEqual,
  });
  if (!admission.ok) {
    host.onConnectionEvent({
      phase: 'hello-reject',
      connectionId: connection.connectionId,
      code: 4004,
      reason: 'authentication-failed',
    });
    host.sendError(connection, 'authentication-required', admission.message);
    connection.socket.close(4004, 'Authentication failed');
    return;
  }
  if (
    admission.pairedDeviceId !== undefined &&
    host.devicePairingStore !== undefined &&
    host.devicePairing !== undefined &&
    admission.issuedDeviceSecret === undefined
  ) {
    void host.devicePairingStore.save(host.devicePairing).catch((error: unknown) => {
      host.onError(toError(error, 'Unable to persist paired-device lastSeen'));
    });
  }

  if (connection.egressChannel !== undefined) {
    connection.egressDetach();
    connection.egressChannel = undefined;
  }

  connection.authenticated = true;
  connection.clientId = message.clientId.trim();
  connection.hydrationEnabled = message.capabilities?.hydration === true;
  connection.liveSubscriptions = message.capabilities?.liveSubscriptions === true;
  connection.browserFrameBinary = message.capabilities?.browserFrameBinary === true;
  connection.subscribedSessionIds = connection.liveSubscriptions
    ? normalizeHydrationSessionIds(message.subscriptions?.sessionIds).slice(
        0,
        LIVE_SUBSCRIPTION_MAX_SESSION_IDS,
      )
    : [];
  connection.deviceId = admission.pairedDeviceId;
  connection.idempotencyScope = admission.pairedDeviceId ?? message.clientId.trim();
  clearTimeout(connection.handshakeTimer);
  const egressClientId = `client:${message.clientId}:${randomUUID()}`;
  connection.egressClientId = egressClientId;
  const currentSeq = host.egressHub.getCurrentSeq();
  const hostChanged =
    message.lastHostInstanceId !== undefined && message.lastHostInstanceId !== host.instanceId;
  const requestedSeq = hostChanged ? 0 : normalizeSeq(message.lastSeq);
  // Future cursor (Host restarted, journal reset, same or missing instance id)
  // must not fence the egress channel ahead of the live head.
  const futureCursor = requestedSeq > currentSeq;
  const initialSeq = futureCursor ? 0 : requestedSeq;
  const forceHydration = hostChanged || futureCursor;
  const liveFilter: LiveSessionFilter = connection.liveSubscriptions
    ? { sessionIds: new Set(connection.subscribedSessionIds) }
    : 'all';
  const egressChannel = host.egressHub.addClient({
    id: egressClientId,
    initialSeq,
    supportsBatch:
      message.capabilities?.pushBatching === true && message.capabilities.cursorBatches === true,
    liveFilter,
    deliverOwnerActions: isLiveOwnerConnection({
      loopbackHost: isLoopbackHost(host.host),
      ...(connection.deviceId === undefined ? {} : { pairedDeviceId: connection.deviceId }),
    }),
    ownerDeviceId: connection.deviceId ?? 'local',
    canSend: () =>
      connection.socket.readyState === OPEN_READY_STATE &&
      connection.socket.bufferedAmount < HOST_SOCKET_SEND_BUDGET_BYTES,
    sendNow: (frame) => host.send(connection, host.projectOutboundPush(frame, connection)),
    sendBatchNow: (frame) => host.send(connection, host.projectOutboundBatch(frame, connection)),
    closeSlowConsumer: (reason) => {
      host.onConnectionEvent({
        phase: 'slow-consumer',
        connectionId: connection.connectionId,
        ...(connection.clientId === undefined ? {} : { clientId: connection.clientId }),
        reason,
      });
      connection.socket.close(4008, reason);
    },
  });
  connection.egressChannel = egressChannel;
  connection.egressDetach = () => host.egressHub.removeClient(egressClientId);
  egressChannel.setPaused(true);
  if (host.clientToolBroker !== undefined && connection.deviceId !== undefined) {
    host.clientToolBroker.attach({
      deviceId: connection.deviceId,
      connectionEpoch: connection.connectionId,
      capabilities: message.capabilities?.clientTools ?? [],
      clientType: message.clientType,
      clientVersion: message.clientVersion,
      send: (frame) => host.send(connection, frame),
    });
  }
  host.send(
    connection,
    createHostHelloPayload(host, admission.pairedDeviceId, admission.issuedDeviceSecret),
  );
  host.onConnectionEvent({
    phase: 'hello-ok',
    connectionId: connection.connectionId,
    clientId: connection.clientId,
    ...(connection.deviceId === undefined ? {} : { deviceId: connection.deviceId }),
    seq: currentSeq,
  });
  try {
    await replayHostConnection(
      host.hydrationHost(connection),
      connection,
      `hello-replay-${message.clientId}-${randomUUID()}`,
      initialSeq,
      forceHydration,
      message.subscriptions,
    );
  } finally {
    egressChannel.setPaused(false);
  }
}
