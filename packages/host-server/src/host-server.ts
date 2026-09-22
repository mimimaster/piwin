import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  HostHello,
  HostMode,
  HostWireMessage,
  RemoteCapabilitySummary,
} from '@piwin/contracts';
import { HOST_PROTOCOL_VERSION, LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';
import type { HostRuntime } from '@piwin/host-runtime';
import { WebSocket, WebSocketServer } from 'ws';
import {
  decodeHostWireMessage,
  encodeBrowserFrameBinary,
  encodeHostWireMessage,
  HOST_WIRE_HARD_FRAME_BYTES,
  HostProtocolError,
  type LiveSessionFilter,
} from '@piwin/host-transport';
import {
  createRemoteCapabilities,
  projectRemotePush,
  projectRemoteResponse,
  type RemoteProjectionContext,
} from './remote-projection.js';
import type { HostEgressChannel } from './host-egress-channel.js';
import { HostEgressHub } from './host-egress-hub.js';
import { HostReplayJournal } from './host-replay-journal.js';
import {
  HostCommandIdempotencyRegistry,
  admitAndExecuteHostCommand,
} from './host-command-idempotency-registry.js';
import type { HostDevicePairing } from './device-pairing.js';
import type { HostDevicePairingFileStore } from './device-pairing-store.js';
import { authenticateHostHello } from './host-hello-auth.js';
import { enrichHostListenError } from './listen-busy.js';
import type { DeviceToolBroker } from './device-tool-broker.js';
import { ClientToolFrameRouter } from './client-tool-frame-router.js';
import {
  compareClientVersions,
  HOST_IDLE_CONNECTION_MS,
  HOST_LIVENESS_SWEEP_MS,
  HOST_SOCKET_SEND_BUDGET_BYTES,
  isHostIngressBypassCommand,
  waitForSocketSendBudget,
  type HostConnectionEvent,
} from './host-connection-lifecycle.js';
import {
  applyLiveSubscriptionUpdate,
  replayHostConnection,
  type HostHydrationHost,
} from './host-server-hydration.js';
import {
  authTokensEqual,
  formatWebSocketUrl,
  isLoopbackBrowserOrigin,
  isLoopbackHost,
  isSafeRemoteCommand,
  normalizeHydrationSessionIds,
  normalizeSeq,
  rememberRemoteMediaAsset,
  rememberRemoteMediaRefsFromPush,
  requestIdFromSerializedWire,
  resolveRemoteCommand,
  toError,
} from './host-server-support.js';
import { stampSubscriptionAuthCommand } from './stamp-subscription-auth.js';
import { serveWebShell } from './web-shell.js';
import {
  isLiveOwnerCommand,
  isLiveOwnerConnection,
  liveOwnerCommandRejectedReason,
} from './live-remote-gate.js';

export type HostRuntimePort = Pick<
  HostRuntime,
  'handleCommand' | 'attachPushSink' | 'attachBrowserFrameSink'
> & {
  runWithDevicePrincipal?: HostRuntime['runWithDevicePrincipal'];
};

export type HostServerOptions = {
  runtime: HostRuntimePort;
  host?: string;
  port?: number;
  mode?: HostMode;
  instanceId?: string;
  authToken?: string;
  /** In-memory pairing authority. Required (with a store) for device enrollment. */
  devicePairing?: HostDevicePairing;
  devicePairingStore?: HostDevicePairingFileStore;
  /** Browser Origin allowlist; absent Origin remains valid for CLI/Node clients. */
  allowedOrigins?: readonly string[];
  /**
   * Accepted for compatibility. Admitted clients already receive the full
   * command surface. This is not a guest role.
   */
  allowRemoteExtensionActivation?: boolean;
  maxReplay?: number;
  maxClientQueueItems?: number;
  maxClientQueueBytes?: number;
  hostBuildId?: string;
  minClientVersion?: string;
  onError?: (error: Error) => void;
  onConnectionEvent?: (event: HostConnectionEvent) => void;
  /** Shared with HostRuntime via the composition root. */
  clientToolBroker?: DeviceToolBroker;
  /** Injected shared hub. When set, HostServer does not own start/stop/dispose. */
  egressHub?: HostEgressHub;
  /** Injected process-lifetime mutation identity. */
  idempotencyRegistry?: HostCommandIdempotencyRegistry;
  /** Directory of a built Web shell. The same port serves the page and the socket. */
  webRoot?: string;
};

export type HostServerAddress = {
  host: string;
  port: number;
  url: string;
};

type ClientConnection = {
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
  idempotencyScope: string;
  connectionId: string;
  clientId: string | undefined;
  lastInboundAt: number;
  ingressTail: Promise<void>;
  /** Client declared the out-of-band binary browser-frame channel. */
  browserFrameBinary: boolean;
  /** Lease id from this client's successful `browser/start`; undefined when idle. */
  browserMirrorLease: string | undefined;
  /** Latest-only pending frame; a newer frame overwrites an unsent one. */
  pendingBrowserFrame: Uint8Array | undefined;
  browserFrameFlush: ReturnType<typeof setTimeout> | undefined;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const OPEN_READY_STATE = 1;
const CONNECTING_READY_STATE = 0;

// Admitted clients are the operator. There is no guest command ceiling;
// hello omits `allowedCommands`. Payload checks in isSafeRemoteCommand remain
// (size caps, path traversal), not a role.

export class HostServer {
  private readonly runtime: HostRuntimePort;
  private readonly host: string;
  private readonly port: number;
  private readonly mode: HostMode;
  private readonly instanceId: string;
  private readonly authToken: string | undefined;
  private readonly devicePairing: HostDevicePairing | undefined;
  private readonly devicePairingStore: HostDevicePairingFileStore | undefined;
  private readonly allowedOrigins: ReadonlySet<string> | undefined;
  private readonly capabilities: RemoteCapabilitySummary;
  private readonly connections = new Set<ClientConnection>();
  private readonly idempotencyRegistry: HostCommandIdempotencyRegistry;
  private readonly ownsIdempotencyRegistry: boolean;
  private readonly remoteMediaPaths = new Map<string, string>();
  private readonly onError: (error: Error) => void;
  private readonly onConnectionEvent: (event: HostConnectionEvent) => void;
  private readonly hostBuildId: string | undefined;
  private readonly minClientVersion: string | undefined;
  private readonly egressHub: HostEgressHub;
  private readonly ownsEgressHub: boolean;
  private readonly unsubscribeIngest: (() => void) | undefined;
  private readonly clientToolBroker: DeviceToolBroker | undefined;
  private readonly clientToolRouter: ClientToolFrameRouter | undefined;
  private readonly webRoot: string | undefined;
  private server: WebSocketServer | undefined;
  private livenessTimer: ReturnType<typeof setInterval> | undefined;
  private browserFrameDetach: (() => void) | undefined;

  public constructor(options: HostServerOptions) {
    if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0)) {
      throw new Error('Host server port must be a non-negative integer');
    }
    this.runtime = options.runtime;
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.mode = options.mode ?? 'sdk';
    this.instanceId = options.instanceId ?? randomUUID();
    this.authToken = options.authToken;
    this.devicePairing = options.devicePairing;
    this.devicePairingStore = options.devicePairingStore;
    this.allowedOrigins =
      options.allowedOrigins === undefined ? undefined : new Set(options.allowedOrigins);
    this.clientToolBroker = options.clientToolBroker;
    this.clientToolRouter =
      options.clientToolBroker === undefined
        ? undefined
        : new ClientToolFrameRouter(options.clientToolBroker);
    this.capabilities = {
      ...createRemoteCapabilities(),
      ...(options.clientToolBroker === undefined ? {} : { clientToolRequests: true as const }),
    };
    this.onError = options.onError ?? (() => undefined);
    this.onConnectionEvent = options.onConnectionEvent ?? (() => undefined);
    this.hostBuildId = options.hostBuildId?.trim() || undefined;
    this.minClientVersion = options.minClientVersion?.trim() || undefined;
    const webRoot = options.webRoot?.trim();
    this.webRoot = webRoot === undefined || webRoot.length === 0 ? undefined : webRoot;
    this.ownsIdempotencyRegistry = options.idempotencyRegistry === undefined;
    this.idempotencyRegistry = options.idempotencyRegistry ?? new HostCommandIdempotencyRegistry();
    if (options.egressHub !== undefined) {
      this.ownsEgressHub = false;
      this.egressHub = options.egressHub;
      this.instanceId = options.instanceId ?? options.egressHub.getHostInstanceId();
      if (this.instanceId !== options.egressHub.getHostInstanceId()) {
        throw new Error('Host server instance id must match the injected egress hub');
      }
      this.unsubscribeIngest = this.egressHub.subscribeIngest((push) =>
        rememberRemoteMediaRefsFromPush(this.remoteMediaPaths, push),
      );
    } else {
      this.ownsEgressHub = true;
      this.egressHub = new HostEgressHub({
        hostInstanceId: this.instanceId,
        attachRuntimeSink: (sink) =>
          this.runtime.attachPushSink({
            id: sink.id,
            sequenced: false,
            push: (message) => {
              sink.push(message);
            },
          }),
        onCanonicalIngest: (push) => rememberRemoteMediaRefsFromPush(this.remoteMediaPaths, push),
        ...(options.maxReplay === undefined
          ? {}
          : { journal: new HostReplayJournal({ maxItems: options.maxReplay }) }),
        ...(options.maxClientQueueItems === undefined
          ? {}
          : { maxClientQueueItems: options.maxClientQueueItems }),
        ...(options.maxClientQueueBytes === undefined
          ? {}
          : { maxClientQueueBytes: options.maxClientQueueBytes }),
        onError: this.onError,
      });
    }
  }

  public getInstanceId(): string {
    return this.instanceId;
  }

  public getCurrentSeq(): number {
    return this.egressHub.getCurrentSeq();
  }

  public async start(): Promise<HostServerAddress> {
    if (this.server !== undefined) {
      throw new Error('Host server is already started');
    }
    this.browserFrameDetach = this.runtime.attachBrowserFrameSink((header, bytes) => {
      this.deliverBrowserFrame(header, bytes);
    });
    if (
      this.authToken === undefined &&
      this.devicePairing === undefined &&
      !isLoopbackHost(this.host)
    ) {
      throw new Error(
        'An auth token or device pairing store is required when Host binds beyond loopback',
      );
    }

    const webRoot = this.webRoot;
    const server = new WebSocketServer({
      host: this.host,
      port: this.port,
      maxPayload: HOST_WIRE_HARD_FRAME_BYTES,
    });
    if (webRoot !== undefined) {
      const httpServer = server.options.server;
      if (httpServer === undefined || httpServer === null) {
        throw new Error('Host Web shell requires the WebSocket HTTP server');
      }
      httpServer.on('request', (request, response) => {
        if (request.headers.upgrade?.toLowerCase() === 'websocket') {
          return;
        }
        void serveWebShell(webRoot, request, response).catch((error: unknown) => {
          this.onError(toError(error, 'Host Web shell failed'));
          if (!response.headersSent) {
            response.writeHead(500).end();
          }
        });
      });
    }
    this.server = server;
    server.on('connection', (socket, request) => this.handleConnection(socket, request));
    this.livenessTimer = setInterval(() => this.sweepIdleConnections(), HOST_LIVENESS_SWEEP_MS);
    this.livenessTimer.unref?.();

    let listening = false;
    const listeningPromise = new Promise<HostServerAddress>((resolve, reject) => {
      server.on('error', (error) => {
        const normalized = toError(error, 'Host WebSocket server error');
        if (!listening) {
          reject(enrichHostListenError(normalized, this.host, this.port));
          return;
        }
        this.onError(normalized);
      });
      server.once('listening', () => {
        listening = true;
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('Host WebSocket server did not expose a TCP address'));
          return;
        }
        const info = address as AddressInfo;
        resolve({
          host: this.host,
          port: info.port,
          url: formatWebSocketUrl(this.host, info.port),
        });
      });
    });

    try {
      this.egressHub.start();
      return await listeningPromise;
    } catch (error) {
      await this.stop();
      throw enrichHostListenError(error, this.host, this.port);
    }
  }

  public getEgressHub(): HostEgressHub {
    return this.egressHub;
  }

  public getIdempotencyRegistry(): HostCommandIdempotencyRegistry {
    return this.idempotencyRegistry;
  }

  public async stop(closeReason = 'Host server stopping'): Promise<void> {
    this.browserFrameDetach?.();
    this.browserFrameDetach = undefined;
    for (const connection of this.connections) {
      if (connection.browserFrameFlush !== undefined) {
        clearTimeout(connection.browserFrameFlush);
        connection.browserFrameFlush = undefined;
      }
      connection.pendingBrowserFrame = undefined;
    }
    if (this.ownsEgressHub) {
      this.clientToolBroker?.dispose();
    }
    if (this.livenessTimer !== undefined) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = undefined;
    }
    for (const connection of this.connections) {
      clearTimeout(connection.handshakeTimer);
      if (
        connection.socket.readyState === OPEN_READY_STATE ||
        connection.socket.readyState === CONNECTING_READY_STATE
      ) {
        try {
          connection.socket.close(1001, closeReason);
        } catch {
          try {
            connection.socket.terminate();
          } catch {
            // Best-effort teardown.
          }
        }
      }
    }
    for (const connection of this.connections) {
      connection.egressDetach();
    }
    this.connections.clear();
    if (this.ownsEgressHub) {
      this.egressHub.stop();
      if (this.ownsIdempotencyRegistry) {
        this.idempotencyRegistry.dispose();
      }
    } else {
      this.unsubscribeIngest?.();
    }

    const server = this.server;
    this.server = undefined;
    if (server === undefined) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        for (const client of server.clients) {
          try {
            client.terminate();
          } catch {
            // Ignore terminate races during forced shutdown.
          }
        }
        server.close(() => resolve());
      }, 2_000);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  public disconnectDevice(deviceId: string, reason: string): void {
    const normalized = deviceId.trim();
    if (normalized.length === 0) {
      return;
    }
    for (const connection of [...this.connections]) {
      if (connection.deviceId !== normalized || connection.socket.readyState !== OPEN_READY_STATE) {
        continue;
      }
      connection.socket.close(4004, reason);
    }
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    if (!this.isAllowedOrigin(request.headers.origin)) {
      this.onConnectionEvent({
        phase: 'hello-reject',
        connectionId: 'pre-hello',
        code: 4009,
        reason: 'Origin not allowed',
      });
      socket.close(4009, 'Origin not allowed');
      return;
    }
    const connection: ClientConnection = {
      socket,
      authenticated: false,
      hydrationEnabled: false,
      liveSubscriptions: false,
      subscribedSessionIds: [],
      egressClientId: undefined,
      egressChannel: undefined,
      egressDetach: () => undefined,
      deviceId: undefined,
      idempotencyScope: '',
      connectionId: randomUUID(),
      clientId: undefined,
      lastInboundAt: Date.now(),
      ingressTail: Promise.resolve(),
      browserFrameBinary: false,
      browserMirrorLease: undefined,
      pendingBrowserFrame: undefined,
      browserFrameFlush: undefined,
      handshakeTimer: setTimeout(() => {
        if (!connection.authenticated) {
          this.sendError(connection, 'authentication-required', 'Host hello is required');
          socket.close(4001, 'Host hello required');
        }
      }, HANDSHAKE_TIMEOUT_MS),
    };
    this.connections.add(connection);
    this.onConnectionEvent({ phase: 'accept', connectionId: connection.connectionId });
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
            void this.handleWireMessage(connection, serialized).catch((error: unknown) => {
              this.sendError(
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
        .then(() => this.handleWireMessage(connection, serialized))
        .catch((error: unknown) => {
          this.sendError(
            connection,
            'request-failed',
            toError(error, 'Host request failed').message,
            requestIdFromSerializedWire(serialized),
          );
        });
    });
    socket.on('close', (code, reasonBuffer) => {
      clearTimeout(connection.handshakeTimer);
      this.clientToolBroker?.detach(connection.connectionId);
      connection.egressDetach();
      this.connections.delete(connection);
      this.onConnectionEvent({
        phase: 'close',
        connectionId: connection.connectionId,
        ...(connection.clientId === undefined ? {} : { clientId: connection.clientId }),
        ...(connection.deviceId === undefined ? {} : { deviceId: connection.deviceId }),
        code,
        reason: reasonBuffer.toString(),
      });
    });
    socket.on('error', (error) => this.onError(toError(error, 'Host client socket error')));
  }

  private sweepIdleConnections(): void {
    const now = Date.now();
    for (const connection of [...this.connections]) {
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
      this.onConnectionEvent({
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

  private isAllowedOrigin(origin: string | string[] | undefined): boolean {
    const normalized = Array.isArray(origin) ? origin[0] : origin;
    if (normalized === undefined || normalized.length === 0) {
      // CLI / Node / native clients often omit Origin.
      return true;
    }
    if (this.allowedOrigins !== undefined) {
      return this.allowedOrigins.has(normalized) || this.allowedOrigins.has('*');
    }
    return isLoopbackBrowserOrigin(normalized);
  }

  private async handleWireMessage(connection: ClientConnection, serialized: string): Promise<void> {
    let message: HostWireMessage;
    try {
      message = decodeHostWireMessage(serialized);
    } catch (error) {
      this.sendError(connection, 'bad-message', toError(error, 'Invalid Host message').message);
      return;
    }

    if (!connection.authenticated) {
      if (message.type !== 'client/hello') {
        this.sendError(connection, 'not-authenticated', 'Host hello is required');
        return;
      }
      await this.acceptHello(connection, message);
      return;
    }

    if (message.type === 'client-tool/result' || message.type === 'client-tool/capabilities') {
      if (this.clientToolRouter === undefined || connection.deviceId === undefined) {
        this.sendError(connection, 'bad-message', `Unexpected Host message type: ${message.type}`);
        return;
      }
      if (message.type === 'client-tool/result') {
        this.clientToolRouter.handleResult(
          { connectionEpoch: connection.connectionId, deviceId: connection.deviceId },
          message,
        );
      } else {
        this.clientToolRouter.handleCapabilities(
          { connectionEpoch: connection.connectionId, deviceId: connection.deviceId },
          message,
        );
      }
      return;
    }

    if (message.type === 'client/subscriptions') {
      await applyLiveSubscriptionUpdate(this.hydrationHost(connection), connection, message);
      return;
    }

    if (message.type === 'command') {
      // Ping must not wait behind session/prompt or a tool-output flood.
      // The desktop heartbeat treats a missed reply as a dead Host.
      if (message.command.type === 'host/ping') {
        await this.sendResponse(connection, {
          type: 'response',
          requestId: message.requestId,
          response: {
            type: 'response',
            command: 'host/ping',
            success: true,
            data: { pong: true },
            ...(message.command.id === undefined ? {} : { id: message.command.id }),
          },
        });
        return;
      }
      await this.handleCommand(connection, message);
    } else if (message.type === 'replay') {
      await replayHostConnection(
        this.hydrationHost(connection),
        connection,
        message.requestId,
        message.sinceSeq,
      );
    } else {
      this.sendError(connection, 'bad-message', `Unexpected Host message type: ${message.type}`);
    }
  }

  private async acceptHello(
    connection: ClientConnection,
    message: Extract<HostWireMessage, { type: 'client/hello' }>,
  ): Promise<void> {
    if (message.protocolVersion !== HOST_PROTOCOL_VERSION) {
      this.onConnectionEvent({
        phase: 'hello-reject',
        connectionId: connection.connectionId,
        code: 4002,
        reason: 'protocol-mismatch',
      });
      this.sendError(connection, 'protocol-mismatch', 'Unsupported Host protocol version');
      connection.socket.close(4002, 'Protocol mismatch');
      return;
    }
    if (
      this.minClientVersion !== undefined &&
      compareClientVersions(message.clientVersion, this.minClientVersion) < 0
    ) {
      this.onConnectionEvent({
        phase: 'hello-reject',
        connectionId: connection.connectionId,
        code: 4002,
        reason: 'client-version-too-old',
      });
      this.sendError(
        connection,
        'protocol-mismatch',
        `Client version ${message.clientVersion} is older than required ${this.minClientVersion}`,
      );
      connection.socket.close(4002, 'Client version too old');
      return;
    }
    if (message.clientId.trim().length === 0) {
      this.onConnectionEvent({
        phase: 'hello-reject',
        connectionId: connection.connectionId,
        code: 4003,
        reason: 'invalid-client-id',
      });
      this.sendError(connection, 'bad-message', 'clientId is required');
      connection.socket.close(4003, 'Invalid client ID');
      return;
    }

    const admission = await authenticateHostHello(message, {
      authToken: this.authToken,
      devicePairing: this.devicePairing,
      allowAnonymousHello: this.authToken === undefined && isLoopbackHost(this.host),
      persistEnrollment: async (pairing) => {
        if (this.devicePairingStore !== undefined) {
          await this.devicePairingStore.save(pairing);
        }
      },
      tokensEqual: authTokensEqual,
    });
    if (!admission.ok) {
      this.onConnectionEvent({
        phase: 'hello-reject',
        connectionId: connection.connectionId,
        code: 4004,
        reason: 'authentication-failed',
      });
      this.sendError(connection, 'authentication-required', admission.message);
      connection.socket.close(4004, 'Authentication failed');
      return;
    }
    if (
      admission.pairedDeviceId !== undefined &&
      this.devicePairingStore !== undefined &&
      this.devicePairing !== undefined &&
      admission.issuedDeviceSecret === undefined
    ) {
      void this.devicePairingStore.save(this.devicePairing).catch((error: unknown) => {
        this.onError(toError(error, 'Unable to persist paired-device lastSeen'));
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
    const currentSeq = this.egressHub.getCurrentSeq();
    const hostChanged =
      message.lastHostInstanceId !== undefined && message.lastHostInstanceId !== this.instanceId;
    const requestedSeq = hostChanged ? 0 : normalizeSeq(message.lastSeq);
    // Future cursor (Host restarted, journal reset, same or missing instance id)
    // must not fence the egress channel ahead of the live head.
    const futureCursor = requestedSeq > currentSeq;
    const initialSeq = futureCursor ? 0 : requestedSeq;
    const forceHydration = hostChanged || futureCursor;
    const liveFilter: LiveSessionFilter = connection.liveSubscriptions
      ? { sessionIds: new Set(connection.subscribedSessionIds) }
      : 'all';
    const egressChannel = this.egressHub.addClient({
      id: egressClientId,
      initialSeq,
      supportsBatch:
        message.capabilities?.pushBatching === true && message.capabilities.cursorBatches === true,
      liveFilter,
      deliverOwnerActions: isLiveOwnerConnection({
        loopbackHost: isLoopbackHost(this.host),
        ...(connection.deviceId === undefined ? {} : { pairedDeviceId: connection.deviceId }),
      }),
      ownerDeviceId: connection.deviceId ?? 'local',
      canSend: () =>
        connection.socket.readyState === OPEN_READY_STATE &&
        connection.socket.bufferedAmount < HOST_SOCKET_SEND_BUDGET_BYTES,
      sendNow: (frame) => this.send(connection, this.projectOutboundPush(frame, connection)),
      sendBatchNow: (frame) =>
        this.send(connection, this.projectOutboundBatch(frame, connection)),
      closeSlowConsumer: (reason) => {
        this.onConnectionEvent({
          phase: 'slow-consumer',
          connectionId: connection.connectionId,
          ...(connection.clientId === undefined ? {} : { clientId: connection.clientId }),
          reason,
        });
        connection.socket.close(4008, reason);
      },
    });
    connection.egressChannel = egressChannel;
    connection.egressDetach = () => this.egressHub.removeClient(egressClientId);
    egressChannel.setPaused(true);
    if (this.clientToolBroker !== undefined && connection.deviceId !== undefined) {
      this.clientToolBroker.attach({
        deviceId: connection.deviceId,
        connectionEpoch: connection.connectionId,
        capabilities: message.capabilities?.clientTools ?? [],
        clientType: message.clientType,
        clientVersion: message.clientVersion,
        send: (frame) => this.send(connection, frame),
      });
    }
    this.send(
      connection,
      this.createHostHello(admission.pairedDeviceId, admission.issuedDeviceSecret),
    );
    this.onConnectionEvent({
      phase: 'hello-ok',
      connectionId: connection.connectionId,
      clientId: connection.clientId,
      ...(connection.deviceId === undefined ? {} : { deviceId: connection.deviceId }),
      seq: currentSeq,
    });
    try {
      await replayHostConnection(
        this.hydrationHost(connection),
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

  private createHostHello(deviceId?: string, deviceSecret?: string): HostHello {
    return {
      type: 'host/hello',
      protocolVersion: HOST_PROTOCOL_VERSION,
      hostInstanceId: this.instanceId,
      currentSeq: this.egressHub.getCurrentSeq(),
      authRequired: this.authToken !== undefined || this.devicePairing !== undefined,
      authenticated: true,
      capabilities: this.capabilities,
      ...(this.hostBuildId === undefined ? {} : { hostBuildId: this.hostBuildId }),
      ...(this.minClientVersion === undefined ? {} : { minClientVersion: this.minClientVersion }),
      ...(deviceId === undefined ? {} : { deviceId }),
      ...(deviceSecret === undefined ? {} : { deviceSecret }),
    };
  }

  private async handleCommand(
    connection: ClientConnection,
    frame: Extract<HostWireMessage, { type: 'command' }>,
  ): Promise<void> {
    let commandAllowed = false;
    try {
      commandAllowed = isSafeRemoteCommand(frame.command);
    } catch {
      commandAllowed = false;
    }
    if (!commandAllowed) {
      this.sendError(
        connection,
        'command-not-allowed',
        `Remote command payload was rejected: ${frame.command.type}`,
        frame.requestId,
      );
      return;
    }
    if (
      isLiveOwnerCommand(frame.command.type) &&
      !isLiveOwnerConnection({
        loopbackHost: isLoopbackHost(this.host),
        ...(connection.deviceId === undefined ? {} : { pairedDeviceId: connection.deviceId }),
      })
    ) {
      await this.sendResponse(connection, {
        type: 'response',
        requestId: frame.requestId,
        response: {
          type: 'response',
          command: frame.command.type,
          success: false,
          error: liveOwnerCommandRejectedReason(),
          problem: {
            code: 'command-not-allowed',
            retryable: false,
            data: { reason: 'live-local-owner-only' },
          },
        },
      });
      return;
    }

    // Remote session/prompt must send `foreground`. Admission itself lives in
    // HostRuntime (`if-idle` / `replace-run`); this gate only rejects omit.
    if (frame.command.type === 'session/prompt' && frame.command.foreground === undefined) {
      await this.sendResponse(connection, {
        type: 'response',
        requestId: frame.requestId,
        response: {
          type: 'response',
          command: 'session/prompt',
          success: false,
          error: 'Remote session/prompt requires foreground admission',
          problem: {
            code: 'command-not-allowed',
            retryable: false,
            data: { reason: 'foreground-required' },
          },
        },
      });
      return;
    }

    // The binary frame channel is gated on this client actually mirroring the
    // workbench (spec §4.1.2): remember its lease while it is the panel owner.
    const browserLeaseCommand =
      frame.command.type === 'browser/start' || frame.command.type === 'browser/stop'
        ? frame.command
        : undefined;

    try {
      const safeResponse = await admitAndExecuteHostCommand({
        registry: this.idempotencyRegistry,
        principalId: connection.idempotencyScope,
        idempotencyKey: frame.idempotencyKey,
        command: frame.command,
        execute: async () => {
          const remoteCommand = resolveRemoteCommand(
            stampSubscriptionAuthCommand(frame.command, {
              devicePrincipalId: connection.idempotencyScope,
            }),
            this.remoteMediaPaths,
          );
          const executeCommand = () =>
            frame.idempotencyKey
              ? this.runtime.handleCommand(remoteCommand, {
                  idempotencyKey: frame.idempotencyKey,
                })
              : this.runtime.handleCommand(remoteCommand);
          const response = this.runtime.runWithDevicePrincipal
            ? await this.runtime.runWithDevicePrincipal(connection.idempotencyScope, executeCommand)
            : await executeCommand();
          rememberRemoteMediaAsset(this.remoteMediaPaths, remoteCommand, response);
          return projectRemoteResponse(frame.command, response, this.projectionContext(connection));
        },
      });
      if (browserLeaseCommand !== undefined && safeResponse.success) {
        connection.browserMirrorLease =
          browserLeaseCommand.type === 'browser/start'
            ? (browserLeaseCommand.leaseId ?? 'default')
            : undefined;
        if (connection.browserMirrorLease === undefined) {
          connection.pendingBrowserFrame = undefined;
        }
      }
      await this.sendResponse(connection, {
        type: 'response',
        requestId: frame.requestId,
        response: safeResponse,
      });
    } catch (error) {
      this.sendError(
        connection,
        'request-failed',
        toError(error, 'Host command failed').message,
        frame.requestId,
      );
    }
  }

  private hydrationHost(connection: ClientConnection): HostHydrationHost {
    return {
      runtime: this.runtime,
      instanceId: this.instanceId,
      mode: this.mode,
      capabilities: this.capabilities,
      remoteMediaPaths: this.remoteMediaPaths,
      egressHub: this.egressHub,
      onError: this.onError,
      onConnectionEvent: this.onConnectionEvent,
      send: (_target, message) => this.send(connection, message),
      sendError: (_target, code, message, requestId) =>
        this.sendError(connection, code, message, requestId),
    };
  }

  private projectionContext(connection?: ClientConnection): RemoteProjectionContext {
    const liveOwner =
      connection !== undefined &&
      isLiveOwnerConnection({
        loopbackHost: isLoopbackHost(this.host),
        ...(connection.deviceId === undefined ? {} : { pairedDeviceId: connection.deviceId }),
      });
    return {
      hostInstanceId: this.instanceId,
      mode: this.mode,
      capabilities: this.capabilities,
      remoteMediaPaths: this.remoteMediaPaths,
      ...(liveOwner ? { liveOwner: true } : {}),
      ...(connection === undefined || !connection.browserFrameBinary
        ? {}
        : { browserFrameBinary: true }),
    };
  }

  private async sendResponse(
    connection: ClientConnection,
    message: Extract<HostWireMessage, { type: 'response' }>,
  ): Promise<void> {
    const writable = await waitForSocketSendBudget(() => connection.socket.bufferedAmount);
    if (!writable) {
      this.onConnectionEvent({
        phase: 'slow-consumer',
        connectionId: connection.connectionId,
        ...(connection.clientId === undefined ? {} : { clientId: connection.clientId }),
        reason: 'response-backpressure-timeout',
      });
      connection.socket.close(4008, 'slow-consumer on response');
      return;
    }
    this.send(connection, message);
  }

  private send(connection: ClientConnection, message: HostWireMessage): void {
    if (connection.socket.readyState !== OPEN_READY_STATE) {
      return;
    }
    try {
      connection.socket.send(encodeHostWireMessage(message));
    } catch (error) {
      this.onError(toError(error, 'Unable to send Host message'));
      // Oversized command responses must not tear down the whole session —
      // push an error frame when possible; only close on hard failures.
      if (error instanceof HostProtocolError && message.type === 'response') {
        try {
          connection.socket.send(
            encodeHostWireMessage({
              type: 'error',
              code: 'request-failed',
              message: error.message,
              requestId: message.requestId,
            }),
          );
          return;
        } catch {
          // Fall through to close.
        }
      }
      connection.socket.close(1011, 'Host send failed');
    }
  }

  private sendError(
    connection: ClientConnection,
    code: Extract<HostWireMessage, { type: 'error' }>['code'],
    message: string,
    requestId?: string,
  ): void {
    const errorFrame =
      requestId === undefined
        ? { type: 'error' as const, code, message }
        : { type: 'error' as const, requestId, code, message };
    this.send(connection, errorFrame);
  }

  /**
   * Raw JPEG delivery for the out-of-band channel (spec §4.1.2). Only clients
   * that declared the capability and hold a mirror lease receive frames, each
   * keeps at most one pending frame (newest wins), and a frame that cannot be
   * sent within the socket budget is dropped rather than queued.
   */
  private deliverBrowserFrame(
    header: import('@piwin/contracts').BrowserFrameBinaryHeader,
    bytes: Uint8Array,
  ): void {
    let envelope: Uint8Array;
    try {
      envelope = encodeBrowserFrameBinary(header, bytes);
    } catch (error) {
      // Oversized (or otherwise unencodable) frames are dropped with a
      // diagnostic; they must never close the control connection.
      this.onConnectionEvent({
        phase: 'slow-consumer',
        connectionId: 'browser-frame',
        reason: `browser-frame-dropped:${
          error instanceof Error ? error.message : 'unknown'
        }`,
      });
      return;
    }
    for (const connection of this.connections) {
      if (!connection.browserFrameBinary) continue;
      if (connection.browserMirrorLease === undefined) continue;
      if (connection.socket.readyState !== OPEN_READY_STATE) continue;
      // A newer frame replaces the unsent one; the client waits for the next
      // live frame after a reconnect instead of replaying stale pixels.
      connection.pendingBrowserFrame = envelope;
      if (connection.browserFrameFlush !== undefined) continue;
      connection.browserFrameFlush = setTimeout(() => {
        connection.browserFrameFlush = undefined;
        const pending = connection.pendingBrowserFrame;
        connection.pendingBrowserFrame = undefined;
        if (pending === undefined) return;
        if (connection.socket.readyState !== OPEN_READY_STATE) return;
        if (connection.socket.bufferedAmount >= HOST_SOCKET_SEND_BUDGET_BYTES) return;
        try {
          connection.socket.send(pending);
        } catch (error) {
          this.onError(toError(error, 'Unable to send browser frame'));
        }
      }, 0);
      connection.browserFrameFlush.unref?.();
    }
  }

  private projectOutboundPush(
    frame: Extract<HostWireMessage, { type: 'push' }>,
    connection?: ClientConnection,
  ): Extract<HostWireMessage, { type: 'push' }> {
    return {
      ...frame,
      push: projectRemotePush(frame.push, this.projectionContext(connection)),
    };
  }

  private projectOutboundBatch(
    frame: Extract<HostWireMessage, { type: 'push/batch' }>,
    connection?: ClientConnection,
  ): Extract<HostWireMessage, { type: 'push/batch' }> {
    const context = this.projectionContext(connection);
    return {
      ...frame,
      items: frame.items.map((item) => ({
        ...item,
        push: projectRemotePush(item.push, context),
      })),
    };
  }
}
