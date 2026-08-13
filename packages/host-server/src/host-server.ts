import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  HostCommand,
  HostHello,
  HostMode,
  MediaAttachmentRef,
  HostHydrationFrame,
  HostReplayDoneFrame,
  HostResponse,
  HostSnapshotFrame,
  HostWireMessage,
  PromptAttachment,
  RemoteCapabilitySummary,
  RemoteHostStatusData,
  RemoteSessionMessagesData,
  RemoteSessionSummary,
  RemoteTranscriptMessage,
} from '@piwin/contracts';
import {
  HOST_PROTOCOL_VERSION,
  SESSION_LIST_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MAX_BYTES,
  SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MIN_BYTES,
  SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS,
  SESSION_USER_MESSAGE_INDEX_MAX_TICKS,
  SESSION_USER_MESSAGE_INDEX_MIN_TICKS,
  isSupportedAttachmentMimeType,
} from '@piwin/contracts';
import type { HostRuntime } from '@piwin/host-runtime';
import { WebSocket, WebSocketServer } from 'ws';
import { decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';
import {
  createRemoteCapabilities,
  projectRemotePush,
  projectRemoteResponse,
  projectRemoteStatusData,
  type RemoteProjectionContext,
} from './remote-projection.js';
import { HostEgressChannel } from './host-egress-channel.js';
import { HostEgressHub } from './host-egress-hub.js';
import { HostReplayJournal } from './host-replay-journal.js';

export type HostRuntimePort = Pick<HostRuntime, 'handleCommand' | 'attachPushSink'>;

export type HostServerOptions = {
  runtime: HostRuntimePort;
  host?: string;
  port?: number;
  mode?: HostMode;
  instanceId?: string;
  authToken?: string;
  /** Browser Origin allowlist; absent Origin remains valid for CLI/Node clients. */
  allowedOrigins?: readonly string[];
  /**
   * ADR 0047 §12: extension activation executes code on the Host, so remote
   * `extensions/set_enabled` / `extensions/apply` stay denied unless the
   * operator opts in explicitly. Observation (`extensions/list`) is always
   * allowed. Remote install stays denied unconditionally.
   */
  allowRemoteExtensionActivation?: boolean;
  maxReplay?: number;
  maxClientQueueItems?: number;
  maxClientQueueBytes?: number;
  onError?: (error: Error) => void;
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
  handshakeTimer: ReturnType<typeof setTimeout>;
  egressClientId: string | undefined;
  egressChannel: HostEgressChannel | undefined;
  egressDetach: () => void;
};

type CachedResponse = {
  response: HostResponse;
  expiresAt: number;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const MAX_REMOTE_MEDIA_REFS = 256;
const MAX_REMOTE_MEDIA_BASE64_CHARS = 950_000;
const MAX_HYDRATION_SESSIONS = 200;
const MAX_HYDRATION_SUBSCRIPTIONS = 4;
const MAX_HYDRATION_MESSAGES_PER_SESSION = 16;
const MAX_HYDRATION_TEXT_BYTES = 16 * 1024;
const MAX_HYDRATION_THINKING_BYTES = 8 * 1024;
const MAX_HYDRATION_FRAME_BYTES = 900 * 1024;
const OPEN_READY_STATE = 1;

const DEFAULT_ALLOWED_COMMANDS = new Set<HostCommand['type']>([
  'host/ping',
  'host/status',
  'project/list',
  'project/remove',
  'session/list',
  'session/list-page',
  'session/create',
  'session/resume',
  'session/user-message-index',
  'session/transcript-page',
  'session/transcript-window',
  'session/messages',
  'session/prompt',
  'session/pause',
  'session/resume-run',
  'session/abort',
  'session/steer',
  'session/follow_up',
  'session/runtime-status',
  'session/pin',
  'session/unpin',
  'session/rename',
  'session/archive',
  'session/unarchive',
  'session/tool-output',
  'permission/resolve',
  'media/save',
  'skills/read',
  'extensions/list',
]);

/**
 * Commands that activate extension code on the Host. Excluded from the
 * default allowlist (ADR 0047 §12) and enabled only through the explicit
 * `allowRemoteExtensionActivation` operator opt-in.
 */
const EXTENSION_ACTIVATION_COMMANDS: readonly HostCommand['type'][] = [
  'extensions/set_enabled',
  'extensions/apply',
];

export class HostServer {
  private readonly runtime: HostRuntimePort;
  private readonly host: string;
  private readonly port: number;
  private readonly mode: HostMode;
  private readonly instanceId: string;
  private readonly authToken: string | undefined;
  private readonly allowedOrigins: ReadonlySet<string> | undefined;
  private readonly allowedCommands: ReadonlySet<HostCommand['type']>;
  private readonly capabilities: RemoteCapabilitySummary;
  private readonly connections = new Set<ClientConnection>();
  private readonly idempotencyCache = new Map<string, CachedResponse>();
  private readonly remoteMediaPaths = new Map<string, string>();
  private readonly onError: (error: Error) => void;
  private readonly egressHub: HostEgressHub;
  private server: WebSocketServer | undefined;

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
    this.allowedOrigins =
      options.allowedOrigins === undefined ? undefined : new Set(options.allowedOrigins);
    this.allowedCommands =
      options.allowRemoteExtensionActivation === true
        ? new Set([...DEFAULT_ALLOWED_COMMANDS, ...EXTENSION_ACTIVATION_COMMANDS])
        : DEFAULT_ALLOWED_COMMANDS;
    this.capabilities = createRemoteCapabilities();
    this.onError = options.onError ?? (() => undefined);
    this.egressHub = new HostEgressHub({
      hostInstanceId: this.instanceId,
      attachRuntimeSink: (sink) =>
        this.runtime.attachPushSink({
          id: sink.id,
          sequenced: false,
          push: (message) => sink.push(projectRemotePush(message)),
        }),
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
    if (this.authToken === undefined && !isLoopbackHost(this.host)) {
      throw new Error('An auth token is required when Host binds beyond loopback');
    }

    const server = new WebSocketServer({ host: this.host, port: this.port });
    this.server = server;
    server.on('connection', (socket, request) => this.handleConnection(socket, request));

    let listening = false;
    const listeningPromise = new Promise<HostServerAddress>((resolve, reject) => {
      server.on('error', (error) => {
        const normalized = toError(error, 'Host WebSocket server error');
        if (!listening) {
          reject(normalized);
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
      throw toError(error, 'Unable to start Host server');
    }
  }

  public async stop(): Promise<void> {
    for (const connection of this.connections) {
      clearTimeout(connection.handshakeTimer);
      if (connection.socket.readyState === OPEN_READY_STATE) {
        connection.socket.close(1001, 'Host server stopping');
      }
    }
    for (const connection of this.connections) {
      connection.egressDetach();
    }
    this.connections.clear();
    this.egressHub.stop();

    const server = this.server;
    this.server = undefined;
    if (server === undefined) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    if (!this.isAllowedOrigin(request.headers.origin)) {
      socket.close(4009, 'Origin not allowed');
      return;
    }
    const connection: ClientConnection = {
      socket,
      authenticated: false,
      hydrationEnabled: false,
      egressClientId: undefined,
      egressChannel: undefined,
      egressDetach: () => undefined,
      handshakeTimer: setTimeout(() => {
        if (!connection.authenticated) {
          this.sendError(connection, 'authentication-required', 'Host hello is required');
          socket.close(4001, 'Host hello required');
        }
      }, HANDSHAKE_TIMEOUT_MS),
    };
    this.connections.add(connection);
    socket.on('message', (data) => {
      void this.handleWireMessage(connection, data.toString()).catch((error: unknown) => {
        this.sendError(connection, 'request-failed', toError(error, 'Host request failed').message);
      });
    });
    socket.on('close', () => {
      clearTimeout(connection.handshakeTimer);
      connection.egressDetach();
      this.connections.delete(connection);
    });
    socket.on('error', (error) => this.onError(toError(error, 'Host client socket error')));
  }

  private isAllowedOrigin(origin: string | string[] | undefined): boolean {
    if (this.allowedOrigins === undefined || origin === undefined) return true;
    const normalized = Array.isArray(origin) ? origin[0] : origin;
    return normalized !== undefined && this.allowedOrigins.has(normalized);
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

    if (message.type === 'command') {
      await this.handleCommand(connection, message);
    } else if (message.type === 'replay') {
      await this.replayConnection(connection, message.requestId, message.sinceSeq);
    } else {
      this.sendError(connection, 'bad-message', `Unexpected Host message type: ${message.type}`);
    }
  }

  private async acceptHello(
    connection: ClientConnection,
    message: Extract<HostWireMessage, { type: 'client/hello' }>,
  ): Promise<void> {
    if (message.protocolVersion !== HOST_PROTOCOL_VERSION) {
      this.sendError(connection, 'protocol-mismatch', 'Unsupported Host protocol version');
      connection.socket.close(4002, 'Protocol mismatch');
      return;
    }
    if (message.clientId.trim().length === 0) {
      this.sendError(connection, 'bad-message', 'clientId is required');
      connection.socket.close(4003, 'Invalid client ID');
      return;
    }
    if (this.authToken !== undefined && message.authToken !== this.authToken) {
      this.sendError(connection, 'authentication-required', 'Host authentication failed');
      connection.socket.close(4004, 'Authentication failed');
      return;
    }

    connection.authenticated = true;
    connection.hydrationEnabled = message.capabilities?.hydration === true;
    clearTimeout(connection.handshakeTimer);
    const egressClientId = `client:${message.clientId}:${randomUUID()}`;
    connection.egressClientId = egressClientId;
    const hostChanged =
      message.lastHostInstanceId !== undefined && message.lastHostInstanceId !== this.instanceId;
    const initialSeq = hostChanged ? 0 : normalizeSeq(message.lastSeq);
    const egressChannel = this.egressHub.addClient({
      id: egressClientId,
      initialSeq,
      supportsBatch:
        message.capabilities?.pushBatching === true && message.capabilities.cursorBatches === true,
      canSend: () =>
        connection.socket.readyState === OPEN_READY_STATE &&
        connection.socket.bufferedAmount < 4 * 1024 * 1024,
      sendNow: (frame) => this.send(connection, frame),
      sendBatchNow: (frame) => this.send(connection, frame),
      closeSlowConsumer: (reason) => connection.socket.close(4008, reason),
    });
    connection.egressChannel = egressChannel;
    connection.egressDetach = () => this.egressHub.removeClient(egressClientId);
    egressChannel.setPaused(true);
    this.send(connection, this.createHostHello());
    try {
      await this.replayConnection(
        connection,
        `hello-replay-${message.clientId}-${randomUUID()}`,
        initialSeq,
        hostChanged,
        message.subscriptions,
      );
    } finally {
      egressChannel.setPaused(false);
    }
  }

  private createHostHello(): HostHello {
    return {
      type: 'host/hello',
      protocolVersion: HOST_PROTOCOL_VERSION,
      hostInstanceId: this.instanceId,
      currentSeq: this.egressHub.getCurrentSeq(),
      authRequired: this.authToken !== undefined,
      authenticated: true,
      capabilities: this.capabilities,
    };
  }

  private async handleCommand(
    connection: ClientConnection,
    frame: Extract<HostWireMessage, { type: 'command' }>,
  ): Promise<void> {
    if (!this.allowedCommands.has(frame.command.type) || !isSafeRemoteCommand(frame.command)) {
      this.sendError(
        connection,
        'command-not-allowed',
        `Remote command is not enabled yet: ${frame.command.type}`,
        frame.requestId,
      );
      return;
    }

    this.pruneIdempotencyCache();
    const cached =
      frame.idempotencyKey === undefined
        ? undefined
        : this.idempotencyCache.get(frame.idempotencyKey);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      this.send(connection, {
        type: 'response',
        requestId: frame.requestId,
        response: cached.response,
      });
      return;
    }

    try {
      const remoteCommand = resolveRemoteCommand(frame.command, this.remoteMediaPaths);
      const response = await this.runtime.handleCommand(remoteCommand);
      this.rememberRemoteMediaAsset(remoteCommand, response);
      const safeResponse = projectRemoteResponse(frame.command, response, this.projectionContext());
      if (frame.idempotencyKey !== undefined) {
        this.idempotencyCache.set(frame.idempotencyKey, {
          response: safeResponse,
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        });
      }
      this.send(connection, {
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

  private rememberRemoteMediaAsset(command: HostCommand, response: HostResponse): void {
    if (command.type !== 'media/save' || !response.success || !isRecord(response.data)) {
      return;
    }
    const asset = isRecord(response.data.asset) ? response.data.asset : undefined;
    if (
      asset === undefined ||
      typeof asset.id !== 'string' ||
      typeof asset.absolutePath !== 'string' ||
      asset.id.length === 0 ||
      asset.absolutePath.length === 0
    ) {
      return;
    }
    this.remoteMediaPaths.set(asset.id, asset.absolutePath);
    while (this.remoteMediaPaths.size > MAX_REMOTE_MEDIA_REFS) {
      const oldestId = this.remoteMediaPaths.keys().next().value;
      if (typeof oldestId !== 'string') {
        break;
      }
      this.remoteMediaPaths.delete(oldestId);
    }
  }

  private async replayConnection(
    connection: ClientConnection,
    requestId: string,
    sinceSeq: number,
    forceHydration = false,
    subscriptions?: { sessionIds?: string[] },
  ): Promise<void> {
    const egressChannel = connection.egressChannel;
    if (egressChannel === undefined) {
      this.sendError(connection, 'replay-failed', 'Host egress channel is not ready', requestId);
      return;
    }
    egressChannel.setPaused(true);
    try {
      const normalizedSinceSeq = normalizeSeq(sinceSeq);
      const initialReplay = this.egressHub.listReplay(normalizedSinceSeq);
      const shouldHydrate = forceHydration || !initialReplay.complete;
      let replay = initialReplay;
      let replaySinceSeq = normalizedSinceSeq;
      if (shouldHydrate && connection.hydrationEnabled) {
        const hydration = await this.createHydrationFrame(
          forceHydration ? 'host-instance-changed' : 'replay-too-old',
          subscriptions,
        );
        this.send(connection, hydration);
        replaySinceSeq = hydration.snapshot.snapshotSeq;
        egressChannel.advanceCursor(replaySinceSeq);
        replay = this.egressHub.listReplay(replaySinceSeq);
      } else if (!initialReplay.complete) {
        this.egressHub.noteSnapshotFallback();
        const snapshot: HostSnapshotFrame = {
          type: 'snapshot',
          reason: 'replay-too-old',
          currentSeq: replay.currentSeq,
          status: await this.getRemoteStatus(),
        };
        this.send(connection, snapshot);
      }

      const fromSeq = replaySinceSeq + 1;
      egressChannel.sendReplay(replay.records);
      // The same records may have accumulated in the paused live queue while
      // the replay/snapshot was being built. Advance the channel fence after
      // replay so unpausing cannot send those records a second time; pushes
      // that arrived after currentSeq remain queued for the live tail.
      egressChannel.advanceCursor(replay.currentSeq);
      const toSeq = replay.records.at(-1)?.sequence.seq ?? replaySinceSeq;
      const replayDone: HostReplayDoneFrame = {
        type: 'replay/done',
        requestId,
        fromSeq,
        toSeq,
        currentSeq: replay.currentSeq,
        complete: initialReplay.complete,
      };
      this.send(connection, replayDone);
    } finally {
      egressChannel.setPaused(false);
    }
  }

  private async getRemoteStatus(): Promise<RemoteHostStatusData> {
    try {
      const response = await this.runtime.handleCommand({
        type: 'host/status',
        id: `remote-snapshot-${randomUUID()}`,
      });
      if (response.success) {
        return projectRemoteStatusData(response.data, this.projectionContext());
      }
    } catch (error) {
      this.onError(toError(error, 'Unable to read Host status for snapshot'));
    }

    return {
      hostInstanceId: this.instanceId,
      protocolVersion: HOST_PROTOCOL_VERSION,
      mode: this.mode,
      ready: false,
      mock: false,
      activeSessionCount: 0,
      capabilities: this.capabilities,
    };
  }

  private async createHydrationFrame(
    reason: HostHydrationFrame['reason'],
    subscriptions?: { sessionIds?: string[] },
  ): Promise<HostHydrationFrame> {
    const status = await this.getRemoteStatus();
    const context = this.projectionContext();
    const sessions = await this.loadHydrationSessions(context);
    const requestedSessionIds = normalizeHydrationSessionIds(subscriptions?.sessionIds);
    const messagesBySession: Record<string, RemoteTranscriptMessage[]> = {};
    const truncatedSessionIds: string[] = [];

    for (const sessionId of requestedSessionIds) {
      try {
        const command = { type: 'session/messages' as const, sessionId };
        const response = await this.runtime.handleCommand(command);
        const projected = projectRemoteResponse(command, response, context);
        const data = projected.success && isRecord(projected.data) ? projected.data : undefined;
        const messageData = data as RemoteSessionMessagesData | undefined;
        const messages = Array.isArray(messageData?.messages) ? messageData.messages : [];
        const boundedMessages = messages
          .slice(-MAX_HYDRATION_MESSAGES_PER_SESSION)
          .map(limitHydrationMessage);
        if (messages.length > boundedMessages.length) {
          truncatedSessionIds.push(sessionId);
        }
        messagesBySession[sessionId] = boundedMessages;
      } catch (error) {
        this.onError(toError(error, `Unable to hydrate session ${sessionId}`));
      }
    }

    const snapshot: HostHydrationFrame['snapshot'] = {
      snapshotId: randomUUID(),
      hostInstanceId: this.instanceId,
      snapshotSeq: this.egressHub.getCurrentSeq(),
      status,
      sessions,
      messagesBySession,
      truncatedSessionIds,
    };
    return fitHydrationFrame({ type: 'hydration', reason, snapshot });
  }

  private async loadHydrationSessions(
    context: RemoteProjectionContext,
  ): Promise<RemoteSessionSummary[]> {
    try {
      const command = { type: 'session/list' as const };
      const response = await this.runtime.handleCommand(command);
      const projected = projectRemoteResponse(command, response, context);
      const data = projected.success && isRecord(projected.data) ? projected.data : undefined;
      const sessions = data?.sessions;
      if (!Array.isArray(sessions)) {
        return [];
      }
      return sessions.filter(isRemoteSessionSummary).slice(0, MAX_HYDRATION_SESSIONS);
    } catch (error) {
      this.onError(toError(error, 'Unable to hydrate session list'));
      return [];
    }
  }

  private projectionContext(): RemoteProjectionContext {
    return {
      hostInstanceId: this.instanceId,
      mode: this.mode,
      capabilities: this.capabilities,
    };
  }

  private send(connection: ClientConnection, message: HostWireMessage): void {
    if (connection.socket.readyState !== OPEN_READY_STATE) {
      return;
    }
    try {
      connection.socket.send(encodeHostWireMessage(message));
    } catch (error) {
      this.onError(toError(error, 'Unable to send Host message'));
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

  private pruneIdempotencyCache(): void {
    const now = Date.now();
    for (const [key, cached] of this.idempotencyCache) {
      if (cached.expiresAt <= now) {
        this.idempotencyCache.delete(key);
      }
    }
  }
}

function normalizeSeq(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function formatWebSocketUrl(host: string, port: number): string {
  const displayHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `ws://${displayHost}:${port}`;
}

function isSafeRemoteCommand(command: HostCommand): boolean {
  switch (command.type) {
    case 'session/list':
      return (
        command.projectPath === undefined &&
        (command.scope === undefined || command.scope.kind === 'general') &&
        (command.order === undefined ||
          command.order === 'updated' ||
          command.order === 'alphabetical') &&
        (command.maxItems === undefined ||
          (typeof command.maxItems === 'number' &&
            Number.isSafeInteger(command.maxItems) &&
            command.maxItems > 0))
      );
    case 'session/list-page': {
      const query: unknown = command.query;
      if (!isRecord(query) || !isRecord(query.scope)) {
        return false;
      }
      return (
        query.scope.kind === 'general' &&
        (query.lifecycle === 'active' || query.lifecycle === 'archived') &&
        (query.order === 'updated' || query.order === 'alphabetical') &&
        typeof query.limit === 'number' &&
        Number.isSafeInteger(query.limit) &&
        query.limit > 0 &&
        query.limit <= SESSION_LIST_PAGE_MAX_ITEMS &&
        (query.anchorSessionId === undefined ||
          (typeof query.anchorSessionId === 'string' &&
            query.anchorSessionId.length > 0 &&
            query.anchorSessionId.length <= 256)) &&
        (query.cursor === undefined ||
          (typeof query.cursor === 'string' && query.cursor.length <= 512))
      );
    }
    case 'session/transcript-page': {
      const query: unknown = command.query;
      if (!isRecord(query)) return false;
      return (
        typeof query.sessionId === 'string' &&
        query.sessionId.length > 0 &&
        query.sessionId.length <= 256 &&
        typeof query.limit === 'number' &&
        Number.isSafeInteger(query.limit) &&
        query.limit > 0 &&
        query.limit <= SESSION_TRANSCRIPT_PAGE_MAX_ITEMS &&
        typeof query.maximumBytes === 'number' &&
        Number.isSafeInteger(query.maximumBytes) &&
        query.maximumBytes >= SESSION_TRANSCRIPT_PAGE_MIN_BYTES &&
        query.maximumBytes <= SESSION_TRANSCRIPT_PAGE_MAX_BYTES &&
        (query.beforeCursor === undefined ||
          (typeof query.beforeCursor === 'string' && query.beforeCursor.length <= 512))
      );
    }
    case 'session/user-message-index': {
      const query: unknown = command.query;
      if (!isRecord(query)) return false;
      return (
        typeof query.sessionId === 'string' &&
        query.sessionId.length > 0 &&
        query.sessionId.length <= 256 &&
        typeof query.maximumTicks === 'number' &&
        Number.isSafeInteger(query.maximumTicks) &&
        query.maximumTicks >= SESSION_USER_MESSAGE_INDEX_MIN_TICKS &&
        query.maximumTicks <= SESSION_USER_MESSAGE_INDEX_MAX_TICKS
      );
    }
    case 'session/transcript-window': {
      const query: unknown = command.query;
      if (!isRecord(query)) return false;
      return (
        typeof query.sessionId === 'string' &&
        query.sessionId.length > 0 &&
        query.sessionId.length <= 256 &&
        typeof query.anchorMessageId === 'string' &&
        query.anchorMessageId.length > 0 &&
        query.anchorMessageId.length <= 256 &&
        typeof query.beforeItems === 'number' &&
        Number.isSafeInteger(query.beforeItems) &&
        query.beforeItems >= 0 &&
        typeof query.afterItems === 'number' &&
        Number.isSafeInteger(query.afterItems) &&
        query.afterItems >= 0 &&
        query.beforeItems + query.afterItems + 1 <= SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS &&
        typeof query.maximumBytes === 'number' &&
        Number.isSafeInteger(query.maximumBytes) &&
        query.maximumBytes >= SESSION_TRANSCRIPT_PAGE_MIN_BYTES &&
        query.maximumBytes <= SESSION_TRANSCRIPT_PAGE_MAX_BYTES
      );
    }
    case 'session/create':
      return (
        command.input.projectPath === undefined &&
        command.input.cwd === undefined &&
        command.input.parentSessionId === undefined &&
        command.input.subagent === undefined &&
        (command.input.scope === undefined || command.input.scope.kind === 'general')
      );
    case 'session/prompt':
      return (
        (command.input.attachments === undefined ||
          (command.input.attachments.length <= 8 &&
            command.input.attachments.every(isSafeRemoteAttachment))) &&
        (command.input.contextRefs === undefined || command.input.contextRefs.length === 0) &&
        command.input.text.length <= 512_000
      );
    case 'session/steer':
      return (
        command.message.length <= 512_000 &&
        (command.clientMessageId === undefined || command.clientMessageId.length <= 256)
      );
    case 'session/follow_up':
      return command.message.length <= 512_000;
    case 'media/save':
      return (
        (command.input.source === 'file-picker' ||
          command.input.source === 'drop' ||
          command.input.source === 'paste') &&
        isSupportedAttachmentMimeType(command.input.mimeType) &&
        command.input.base64Data.length > 0 &&
        command.input.base64Data.length <= MAX_REMOTE_MEDIA_BASE64_CHARS
      );
    case 'skills/read':
      // Remote clients may only use the logical skillId; legacyPath and
      // projectPath are Host-local compatibility hints and stay disabled.
      return (
        typeof command.skillId === 'string' &&
        command.skillId.trim().length > 0 &&
        command.skillId.length <= 256 &&
        command.legacyPath === undefined &&
        command.projectPath === undefined &&
        (command.maxBytes === undefined ||
          (Number.isSafeInteger(command.maxBytes) &&
            command.maxBytes >= 1024 &&
            command.maxBytes <= 512 * 1024))
      );
    case 'extensions/list':
      return command.projectPath === undefined;
    case 'extensions/set_enabled':
      return command.extensionId.trim().length > 0 && command.extensionId.length <= 256;
    case 'extensions/apply':
      return (
        command.sessionId.trim().length > 0 &&
        command.sessionId.length <= 256 &&
        (command.expectedSettingsRevision === undefined ||
          command.expectedSettingsRevision.length <= 256) &&
        (command.expectedRegistryRevision === undefined ||
          command.expectedRegistryRevision.length <= 256) &&
        (command.targetExtensionSetRevision === undefined ||
          command.targetExtensionSetRevision.length <= 256) &&
        (command.deploymentId === undefined || command.deploymentId.length <= 256)
      );
    case 'session/tool-output':
      return (
        typeof command.sessionId === 'string' &&
        command.sessionId.length > 0 &&
        command.sessionId.length <= 256 &&
        typeof command.messageId === 'string' &&
        command.messageId.length > 0 &&
        command.messageId.length <= 256 &&
        typeof command.toolCallId === 'string' &&
        command.toolCallId.length > 0 &&
        command.toolCallId.length <= 256 &&
        (command.maxBytes === undefined ||
          (Number.isSafeInteger(command.maxBytes) &&
            command.maxBytes >= 1024 &&
            command.maxBytes <= 512 * 1024))
      );
    default:
      return true;
  }
}

function resolveRemoteCommand(
  command: HostCommand,
  remoteMediaPaths: Map<string, string>,
): HostCommand {
  if (command.type !== 'session/prompt' || command.input.attachments === undefined) {
    return command;
  }
  const attachments = command.input.attachments.map((attachment) => {
    if (attachment.kind !== 'media' || !attachment.path.startsWith('remote-asset:')) {
      return attachment;
    }
    const assetId = attachment.path.slice('remote-asset:'.length);
    const absolutePath = remoteMediaPaths.get(assetId);
    if (absolutePath === undefined) {
      throw new Error('Remote media asset is not available on this Host');
    }
    return { ...attachment, path: absolutePath } satisfies MediaAttachmentRef;
  });
  return { ...command, input: { ...command.input, attachments } };
}

function isSafeRemoteAttachment(attachment: PromptAttachment): boolean {
  return attachment.kind === 'media' && attachment.path.startsWith('remote-asset:');
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeHydrationSessionIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const sessionId of value) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0 || seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    result.push(sessionId);
    if (result.length >= MAX_HYDRATION_SUBSCRIPTIONS) break;
  }
  return result;
}

function isRemoteSessionSummary(value: unknown): value is RemoteSessionSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === 'string' &&
    (value.scope === 'general' || value.scope === 'project' || value.scope === 'unknown')
  );
}

function limitHydrationMessage(message: RemoteTranscriptMessage): RemoteTranscriptMessage {
  const limited: RemoteTranscriptMessage = {
    ...message,
    text: truncateUtf8(message.text, MAX_HYDRATION_TEXT_BYTES),
  };
  if (message.thinking !== undefined) {
    limited.thinking = truncateUtf8(message.thinking, MAX_HYDRATION_THINKING_BYTES);
  }
  return limited;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (new TextEncoder().encode(value).byteLength <= maxBytes) return value;
  let candidate = value.slice(0, maxBytes);
  while (candidate.length > 0 && new TextEncoder().encode(`${candidate}…`).byteLength > maxBytes) {
    candidate = candidate.slice(0, -1);
  }
  return `${candidate}…`;
}

function fitHydrationFrame(frame: HostHydrationFrame): HostHydrationFrame {
  let candidate = frame;
  while (true) {
    try {
      const encoded = encodeHostWireMessage(candidate);
      if (new TextEncoder().encode(encoded).byteLength <= MAX_HYDRATION_FRAME_BYTES) {
        return candidate;
      }
    } catch {
      // Trim below and retry. The resulting frame remains explicit and bounded.
    }

    const messageSessionIds = Object.keys(candidate.snapshot.messagesBySession);
    const removableSessionId = messageSessionIds.at(-1);
    if (removableSessionId !== undefined) {
      const messagesBySession = { ...candidate.snapshot.messagesBySession };
      delete messagesBySession[removableSessionId];
      candidate = {
        ...candidate,
        snapshot: {
          ...candidate.snapshot,
          messagesBySession,
          truncatedSessionIds: [
            ...new Set([...candidate.snapshot.truncatedSessionIds, removableSessionId]),
          ],
        },
      };
      continue;
    }

    if (candidate.snapshot.sessions.length > 0) {
      candidate = {
        ...candidate,
        snapshot: {
          ...candidate.snapshot,
          sessions: candidate.snapshot.sessions.slice(0, -1),
        },
      };
      continue;
    }

    return {
      ...candidate,
      snapshot: { ...candidate.snapshot, messagesBySession: {}, sessions: [] },
    };
  }
}
