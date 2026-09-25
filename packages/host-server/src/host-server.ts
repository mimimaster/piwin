import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  HostMode,
  HostPairingCommand,
  HostWireMessage,
  RemoteCapabilitySummary,
} from '@piwin/contracts';
import { isHostPairingCommandType } from '@piwin/contracts';
import { handleHostPairingCommand } from './host-pairing-commands.js';
import type { HostRuntime } from '@piwin/host-runtime';
import { WebSocket, WebSocketServer } from 'ws';
import {
  decodeHostWireMessage,
  encodeHostWireMessage,
  HOST_WIRE_HARD_FRAME_BYTES,
  HostProtocolError,
} from '@piwin/host-transport';
import {
  createRemoteCapabilities,
  projectRemotePush,
  projectRemoteResponse,
  type RemoteProjectionContext,
} from './remote-projection.js';
import { HostEgressHub } from './host-egress-hub.js';
import { HostReplayJournal } from './host-replay-journal.js';
import {
  HostCommandIdempotencyRegistry,
  admitAndExecuteHostCommand,
} from './host-command-idempotency-registry.js';
import { HostDevicePairing } from './device-pairing.js';
import { HostDevicePairingFileStore } from './device-pairing-store.js';
import type { PairingRegistry } from './pairing-operations.js';
import { isDirectLoopbackRequest } from './host-connection-origin.js';
import { enrichHostListenError } from './listen-busy.js';
import type { DeviceToolBroker } from './device-tool-broker.js';
import { ClientToolFrameRouter } from './client-tool-frame-router.js';
import {
  HOST_LIVENESS_SWEEP_MS,
  waitForSocketSendBudget,
  type HostConnectionEvent,
} from './host-connection-lifecycle.js';
import {
  attachHostClientSocketWiring,
  CONNECTING_READY_STATE,
  createHostClientConnection,
  isAllowedHostClientOrigin,
  OPEN_READY_STATE,
  sweepIdleHostClientConnections,
  type HostClientConnection,
} from './host-client-connection.js';
import {
  clearPendingBrowserFrame,
  deliverBrowserFrame as deliverBrowserFrameToConnections,
} from './browser-frame-dispatch.js';
import { evaluateHostCommandAdmission } from './host-command-admission.js';
import {
  applyLiveSubscriptionUpdate,
  replayHostConnection,
  type HostHydrationHost,
} from './host-server-hydration.js';
import { acceptHostHello, type HostHelloAcceptHost } from './host-hello-accept.js';
import {
  formatWebSocketUrl,
  isLoopbackHost,
  rememberRemoteMediaAsset,
  rememberRemoteMediaRefsFromPush,
  resolveRemoteCommand,
  toError,
} from './host-server-support.js';
import { stampSubscriptionAuthCommand } from './stamp-subscription-auth.js';
import { serveWebShell } from './web-shell.js';
import {
  applyBrowserLeaseCommand,
  createDisconnectedMirrorLeaseReaper,
  type DisconnectedMirrorLeaseReaper,
} from './browser-mirror-leases.js';
import { isLiveOwnerConnection } from './live-remote-gate.js';

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
  /** Root directory for piwin state (~/.piwin). Used for device pairing store fallback. */
  piwinRoot?: string;
  /** Explicit initial pairing status. Defaults to true if devicePairing is provided. */
  pairingEnabled?: boolean;
  /** Address pairing codes point phones at; defaults to the bound URL. */
  pairingAdvertisedEndpoint?: string;
};

export type HostServerAddress = {
  host: string;
  port: number;
  url: string;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;

// Admitted clients are the operator. There is no guest command ceiling;
// hello omits `allowedCommands`. Payload checks in isSafeRemoteCommand remain
// (size caps, path traversal), not a role.

export class HostServer {
  private readonly runtime: HostRuntimePort;
  private readonly piwinRoot: string | undefined;
  private readonly host: string;
  private readonly port: number;
  private readonly mode: HostMode;
  private readonly instanceId: string;
  private readonly authToken: string | undefined;
  private devicePairing: HostDevicePairing | undefined;
  private devicePairingStore: HostDevicePairingFileStore | undefined;
  private pairingEnabled: boolean;
  private readonly allowedOrigins: ReadonlySet<string> | undefined;
  private readonly capabilities: RemoteCapabilitySummary;
  private readonly connections = new Set<HostClientConnection>();
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
  private readonly mirrorLeaseReaper: DisconnectedMirrorLeaseReaper;
  private pairingAdvertisedEndpoint: string | undefined;
  private boundUrl: string | undefined;

  public constructor(options: HostServerOptions) {
    if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0)) {
      throw new Error('Host server port must be a non-negative integer');
    }
    this.runtime = options.runtime;
    this.mirrorLeaseReaper = createDisconnectedMirrorLeaseReaper({
      isHeldByLiveConnection: (lease) =>
        [...this.connections].some((connection) => connection.browserMirrorLeases.has(lease)),
      execute: (command) => this.runtime.handleCommand(command),
      onError: (error) => this.onError(error),
    });
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.mode = options.mode ?? 'sdk';
    this.instanceId = options.instanceId ?? randomUUID();
    this.authToken = options.authToken;
    this.piwinRoot = options.piwinRoot;
    this.devicePairing = options.devicePairing;
    this.devicePairingStore = options.devicePairingStore;
    this.pairingEnabled = options.pairingEnabled ?? (this.devicePairing !== undefined);
    this.pairingAdvertisedEndpoint = options.pairingAdvertisedEndpoint?.trim() || undefined;
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
        this.boundUrl = formatWebSocketUrl(this.host, info.port);
        resolve({ host: this.host, port: info.port, url: this.boundUrl });
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
    this.mirrorLeaseReaper.dispose();
    for (const connection of this.connections) {
      clearPendingBrowserFrame(connection);
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
    if (
      !isAllowedHostClientOrigin({
        origin: request.headers.origin,
        allowedOrigins: this.allowedOrigins,
      })
    ) {
      this.onConnectionEvent({
        phase: 'hello-reject',
        connectionId: 'pre-hello',
        code: 4009,
        reason: 'Origin not allowed',
      });
      socket.close(4009, 'Origin not allowed');
      return;
    }
    const connection = createHostClientConnection({
      socket,
      directLoopback: isDirectLoopbackRequest(request),
      onHandshakeTimeout: (pending) => {
        this.sendError(pending, 'authentication-required', 'Host hello is required');
        socket.close(4001, 'Host hello required');
      },
    });
    this.connections.add(connection);
    this.onConnectionEvent({ phase: 'accept', connectionId: connection.connectionId });
    attachHostClientSocketWiring({
      connection,
      handleWireMessage: (target, serialized) => this.handleWireMessage(target, serialized),
      sendError: (target, code, message, requestId) =>
        this.sendError(target, code, message, requestId),
      onError: (error) => this.onError(error),
      onClose: (closed, code, reason) => {
        clearTimeout(closed.handshakeTimer);
        this.clientToolBroker?.detach(closed.connectionId);
        closed.egressDetach();
        this.connections.delete(closed);
        this.mirrorLeaseReaper.schedule(closed.browserMirrorLeases);
        this.onConnectionEvent({
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

  private sweepIdleConnections(): void {
    sweepIdleHostClientConnections({
      connections: this.connections,
      onConnectionEvent: this.onConnectionEvent,
    });
  }

  private async handleWireMessage(
    connection: HostClientConnection,
    serialized: string,
  ): Promise<void> {
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
      await acceptHostHello(this.helloAcceptHost(), connection, message);
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

  /** Live server state the hello handshake reads; see `host-hello-accept.ts`. */
  private helloAcceptHost(): HostHelloAcceptHost {
    return {
      host: this.host,
      instanceId: this.instanceId,
      authToken: this.authToken,
      minClientVersion: this.minClientVersion,
      hostBuildId: this.hostBuildId,
      capabilities: this.capabilities,
      devicePairing: this.devicePairing,
      devicePairingStore: this.devicePairingStore,
      pairingEnabled: this.pairingEnabled,
      egressHub: this.egressHub,
      clientToolBroker: this.clientToolBroker,
      onError: this.onError,
      onConnectionEvent: this.onConnectionEvent,
      send: (target, message) => this.send(target, message),
      sendError: (target, code, message, requestId) =>
        this.sendError(target, code, message, requestId),
      projectOutboundPush: (frame, target) => this.projectOutboundPush(frame, target),
      projectOutboundBatch: (frame, target) => this.projectOutboundBatch(frame, target),
      hydrationHost: (target) => this.hydrationHost(target),
    };
  }

  private async setPairingEnabled(enabled: boolean, advertisedEndpoint?: string): Promise<void> {
    if (enabled) {
      await this.ensurePairingRegistry();
      this.pairingEnabled = true;
      if (advertisedEndpoint?.trim()) {
        this.pairingAdvertisedEndpoint = advertisedEndpoint.trim();
      }
    } else {
      this.pairingEnabled = false;
      this.devicePairing?.invalidatePendingTokens();
    }
  }

  private async ensurePairingRegistry(): Promise<PairingRegistry> {
    if (this.devicePairing !== undefined) {
      return { pairing: this.devicePairing, store: this.devicePairingStore };
    }
    const root = this.piwinRoot ?? join(homedir(), '.piwin');
    const pairing = new HostDevicePairing();
    const store = new HostDevicePairingFileStore(join(root, 'devices', 'pairing.json'));
    // A corrupt store must fail the enable: starting empty would orphan every paired phone.
    await store.load(pairing);
    this.devicePairing = pairing;
    this.devicePairingStore = store;
    return { pairing, store };
  }

  private async handleCommand(
    connection: HostClientConnection,
    frame: Extract<HostWireMessage, { type: 'command' }>,
  ): Promise<void> {
    if (isHostPairingCommandType(frame.command.type)) {
      // Owned by this server's pairing registry, never by HostRuntime.
      const response = await handleHostPairingCommand(frame.command as HostPairingCommand, {
        pairing: this.devicePairing,
        store: this.devicePairingStore,
        hostInstanceId: this.instanceId,
        advertisedEndpoint: this.pairingAdvertisedEndpoint ?? this.boundUrl,
        callerDeviceId: connection.deviceId,
        pairingEnabled: this.pairingEnabled,
        setEnabled: async (enabled, advertisedEndpoint) => {
          await this.setPairingEnabled(enabled, advertisedEndpoint);
        },
        onRevoked: (deviceId) => {
          this.clientToolBroker?.forgetDevice(deviceId);
          this.disconnectDevice(deviceId, 'device revoked');
        },
      });
      await this.sendResponse(connection, { type: 'response', requestId: frame.requestId, response });
      return;
    }
    const admission = evaluateHostCommandAdmission({
      command: frame.command,
      liveOwner: isLiveOwnerConnection({
        loopbackHost: isLoopbackHost(this.host),
        ...(connection.deviceId === undefined ? {} : { pairedDeviceId: connection.deviceId }),
      }),
    });
    if (admission.kind === 'reject-error-frame') {
      this.sendError(connection, 'command-not-allowed', admission.message, frame.requestId);
      return;
    }
    if (admission.kind === 'reject-response') {
      await this.sendResponse(connection, {
        type: 'response',
        requestId: frame.requestId,
        response: {
          type: 'response',
          command: admission.command,
          success: false,
          error: admission.error,
          problem: {
            code: 'command-not-allowed',
            retryable: false,
            data: { reason: admission.reason },
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
        applyBrowserLeaseCommand(connection.browserMirrorLeases, browserLeaseCommand);
        if (connection.browserMirrorLeases.size === 0) {
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

  private hydrationHost(connection: HostClientConnection): HostHydrationHost {
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

  private projectionContext(connection?: HostClientConnection): RemoteProjectionContext {
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
    connection: HostClientConnection,
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

  private send(connection: HostClientConnection, message: HostWireMessage): void {
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
    connection: HostClientConnection,
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
   * Bridges the runtime frame sink to the out-of-band channel. Delivery policy
   * (capability, lease, latest-only buffering, socket budget) lives in
   * `browser-frame-dispatch.ts`; this only supplies the Host's side effects.
   */
  private deliverBrowserFrame(
    header: import('@piwin/contracts').BrowserFrameBinaryHeader,
    bytes: Uint8Array,
  ): void {
    deliverBrowserFrameToConnections({
      connections: this.connections,
      header,
      bytes,
      onDropped: (detail) => {
        // Oversized (or otherwise unencodable) frames are dropped with a
        // diagnostic; they must never close the control connection.
        this.onConnectionEvent({
          phase: 'slow-consumer',
          connectionId: 'browser-frame',
          reason: `browser-frame-dropped:${detail}`,
        });
      },
      onSendError: (error) => this.onError(error),
    });
  }

  private projectOutboundPush(
    frame: Extract<HostWireMessage, { type: 'push' }>,
    connection?: HostClientConnection,
  ): Extract<HostWireMessage, { type: 'push' }> {
    return {
      ...frame,
      push: projectRemotePush(frame.push, this.projectionContext(connection)),
    };
  }

  private projectOutboundBatch(
    frame: Extract<HostWireMessage, { type: 'push/batch' }>,
    connection?: HostClientConnection,
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
