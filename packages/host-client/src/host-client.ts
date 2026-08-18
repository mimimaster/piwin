import type {
  HostClientHello,
  HostClientSubscriptions,
  HostClientCapabilities,
  HostCommand,
  HostHello,
  HostHydrationFrame,
  HostPush,
  HostPushBatchFrame,
  HostPushFrame,
  HostResponse,
  HostSnapshotFrame,
  HostWireErrorCode,
  HostWireMessage,
  TrustedDeviceCredential,
} from '@piwin/contracts';
import { HOST_PROTOCOL_VERSION, isTrustedDeviceCredential } from '@piwin/contracts';
import type { HostTransport, HostTransportState } from '@piwin/host-transport';

export type HostClientState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'ready' }
  | { kind: 'disconnected'; reason?: string }
  | { kind: 'error'; reason: string }
  | { kind: 'resync-required'; expectedSeq: number; receivedSeq: number };

export type HostClientStateListener = (state: HostClientState) => void;

export type HostClientPushListener = (push: HostPush, frame: HostPushFrame) => void;

export type HostClientBatchListener = (frame: HostPushBatchFrame) => void;

export type HostClientSnapshotListener = (snapshot: HostSnapshotFrame) => void;

export type HostClientHydrationListener = (hydration: HostHydrationFrame) => void;

export type HostClientLastSeqStore = {
  read(): number;
  write(lastSeq: number): void;
};

export type HostClientCursor = {
  hostInstanceId?: string;
  throughSeq: number;
};

export type HostClientCursorStore = {
  read(): HostClientCursor | undefined;
  write(cursor: HostClientCursor): void;
};

export type HostClientOptions = {
  transport: HostTransport;
  clientId: string;
  clientType: 'mobile' | 'desktop' | 'cli' | 'web';
  clientVersion: string;
  authToken?: string;
  pairingToken?: string;
  deviceCredential?: TrustedDeviceCredential;
  deviceName?: string;
  /** Called once when host/hello returns a newly issued device secret. */
  onIssuedDeviceCredential?: (credential: TrustedDeviceCredential) => Promise<void> | void;
  lastSeqStore?: HostClientLastSeqStore;
  cursorStore?: HostClientCursorStore;
  capabilities?: HostClientCapabilities;
  subscriptions?: HostClientSubscriptions;
  requestTimeoutMs?: number;
};

export type HostRequestOptions = {
  timeoutMs?: number;
  idempotencyKey?: string;
};

type PendingRequest = {
  resolve: (response: HostResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const READ_ONLY_COMMANDS = new Set([
  'host/ping',
  'host/status',
  'activity/summary',
  'project/list',
  'session/list',
  'models/configured',
]);

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class HostRequestError extends Error {
  public readonly name = 'HostRequestError';
  public readonly code: HostWireErrorCode;

  public constructor(code: HostWireErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class HostClient {
  private readonly transport: HostTransport;
  private readonly clientId: string;
  private readonly clientType: HostClientOptions['clientType'];
  private readonly clientVersion: string;
  private authToken: string | undefined;
  private pairingToken: string | undefined;
  private deviceCredential: TrustedDeviceCredential | undefined;
  private readonly deviceName: string | undefined;
  private readonly onIssuedDeviceCredential:
    | ((credential: TrustedDeviceCredential) => Promise<void> | void)
    | undefined;
  private readonly lastSeqStore: HostClientLastSeqStore;
  private readonly cursorStore: HostClientCursorStore | undefined;
  private readonly capabilities: HostClientCapabilities;
  private readonly subscriptions: HostClientSubscriptions | undefined;
  private readonly requestTimeoutMs: number;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly stateListeners = new Set<HostClientStateListener>();
  private readonly pushListeners = new Set<HostClientPushListener>();
  private readonly batchListeners = new Set<HostClientBatchListener>();
  private readonly snapshotListeners = new Set<HostClientSnapshotListener>();
  private readonly hydrationListeners = new Set<HostClientHydrationListener>();
  private readonly pendingPushes = new Map<number, HostPushFrame>();
  private readonly unsubscribeTransport: () => void;
  private readonly unsubscribeTransportState: () => void;
  private state: HostClientState = { kind: 'idle' };
  private hostHello: HostHello | undefined;
  private lastSeq: number;
  private hostInstanceId: string | undefined;
  private replayInFlight = false;
  private disposed = false;

  public constructor(options: HostClientOptions) {
    if (options.clientId.trim().length === 0) {
      throw new Error('Host client ID cannot be empty');
    }
    if (options.requestTimeoutMs !== undefined && options.requestTimeoutMs <= 0) {
      throw new Error('Host request timeout must be greater than zero');
    }

    this.transport = options.transport;
    this.clientId = options.clientId;
    this.clientType = options.clientType;
    this.clientVersion = options.clientVersion;
    const admissionKeys = countAdmissionKeys(options);
    if (admissionKeys > 1) {
      throw new Error('Host client must present exactly one admission key');
    }
    if (options.deviceCredential !== undefined && !isTrustedDeviceCredential(options.deviceCredential)) {
      throw new Error('Host client device credential is invalid');
    }
    this.authToken = options.authToken;
    this.pairingToken = options.pairingToken;
    this.deviceCredential = options.deviceCredential;
    this.deviceName = options.deviceName;
    this.onIssuedDeviceCredential = options.onIssuedDeviceCredential;
    this.lastSeqStore = options.lastSeqStore ?? createMemoryLastSeqStore();
    this.cursorStore = options.cursorStore;
    const storedCursor = this.cursorStore?.read();
    this.lastSeq = storedCursor?.throughSeq ?? readLastSeq(this.lastSeqStore);
    this.hostInstanceId = storedCursor?.hostInstanceId;
    this.capabilities = options.capabilities ?? {
      pushBatching: true,
      cursorBatches: true,
      boundedReplay: true,
      hydration: true,
    };
    this.subscriptions = normalizeSubscriptions(options.subscriptions);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.transport.setHelloFactory((lastSeq) => this.createHello(lastSeq));
    this.unsubscribeTransport = this.transport.subscribe((message) => this.handleMessage(message));
    this.unsubscribeTransportState = this.transport.subscribeState((state) =>
      this.handleTransportState(state),
    );
  }

  public getState(): HostClientState {
    return this.state;
  }

  public getHostHello(): HostHello | undefined {
    return this.hostHello;
  }

  public getLastSeq(): number {
    return this.lastSeq;
  }

  public getCursor(): HostClientCursor {
    return this.hostInstanceId === undefined
      ? { throughSeq: this.lastSeq }
      : { hostInstanceId: this.hostInstanceId, throughSeq: this.lastSeq };
  }

  public subscribeState(listener: HostClientStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  public subscribePush(listener: HostClientPushListener): () => void {
    this.pushListeners.add(listener);
    return () => this.pushListeners.delete(listener);
  }

  public subscribeBatch(listener: HostClientBatchListener): () => void {
    this.batchListeners.add(listener);
    return () => this.batchListeners.delete(listener);
  }

  public subscribeSnapshot(listener: HostClientSnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  public subscribeHydration(listener: HostClientHydrationListener): () => void {
    this.hydrationListeners.add(listener);
    return () => this.hydrationListeners.delete(listener);
  }

  public async connect(): Promise<HostHello> {
    this.assertNotDisposed();
    this.publishState({ kind: 'connecting' });
    this.transport.setLastSeq(this.lastSeq);
    try {
      const hello = await this.transport.connect();
      this.hostHello = hello;
      await this.adoptIssuedDeviceCredential(hello);
      this.publishState({ kind: 'ready' });
      return hello;
    } catch (error) {
      const connectionError = toError(error, 'Unable to connect to Host');
      this.publishState({ kind: 'error', reason: connectionError.message });
      throw connectionError;
    }
  }

  public async close(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.unsubscribeTransport();
    this.unsubscribeTransportState();
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Host client closed'));
      this.pendingRequests.delete(requestId);
    }
    await this.transport.close();
    this.publishState({ kind: 'disconnected' });
  }

  public request(command: HostCommand, options: HostRequestOptions = {}): Promise<HostResponse> {
    this.assertNotDisposed();
    const requestId = createRequestId('request');
    const commandWithId = addCommandId(command, requestId);
    const idempotencyKey =
      options.idempotencyKey ??
      (READ_ONLY_COMMANDS.has(commandWithId.type) ? undefined : createRequestId('idempotency'));
    const frame =
      idempotencyKey === undefined
        ? { type: 'command' as const, requestId, command: commandWithId }
        : { type: 'command' as const, requestId, command: commandWithId, idempotencyKey };
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;

    return new Promise<HostResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Host request timed out: ${command.type}`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      try {
        this.transport.send(frame);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(toError(error, `Unable to send Host request: ${command.type}`));
      }
    });
  }

  public requestReplay(): void {
    this.assertNotDisposed();
    this.sendReplayRequest();
  }

  private sendReplayRequest(): void {
    if (this.replayInFlight) {
      return;
    }
    const frame = {
      type: 'replay' as const,
      requestId: createRequestId('replay'),
      sinceSeq: this.lastSeq,
    };
    this.replayInFlight = true;
    try {
      this.transport.send(frame);
    } catch (error) {
      this.replayInFlight = false;
      this.publishState({
        kind: 'error',
        reason: toError(error, 'Unable to request Host replay').message,
      });
    }
  }

  private handleMessage(message: HostWireMessage): void {
    if (message.type === 'host/hello') {
      const hostChanged =
        this.hostInstanceId !== undefined && this.hostInstanceId !== message.hostInstanceId;
      this.hostHello = message;
      if (hostChanged) {
        this.lastSeq = 0;
        this.pendingPushes.clear();
        this.replayInFlight = false;
      }
      this.hostInstanceId = message.hostInstanceId;
      this.persistCursor();
      this.publishState({ kind: 'ready' });
      if (hostChanged && message.capabilities.boundedReplay !== true) {
        this.sendReplayRequest();
      }
      return;
    }

    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending === undefined) {
        return;
      }
      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.requestId);
      pending.resolve(message.response);
      return;
    }

    if (message.type === 'error') {
      if (message.requestId === undefined) {
        this.publishState({ kind: 'error', reason: message.message });
        return;
      }
      const pending = this.pendingRequests.get(message.requestId);
      if (pending === undefined) {
        return;
      }
      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.requestId);
      pending.reject(new HostRequestError(message.code, message.message));
      return;
    }

    if (message.type === 'push') {
      this.handlePush(message);
      return;
    }

    if (message.type === 'push/batch') {
      this.handlePushBatch(message);
      return;
    }

    if (message.type === 'replay/done') {
      this.replayInFlight = false;
      if (this.pendingPushes.size === 0) {
        this.publishState({ kind: 'ready' });
      } else {
        this.publishState({
          kind: 'resync-required',
          expectedSeq: this.lastSeq + 1,
          receivedSeq: getSmallestPendingSeq(this.pendingPushes),
        });
        if (!message.complete) {
          this.sendReplayRequest();
        }
      }
      return;
    }

    if (message.type === 'snapshot') {
      try {
        for (const listener of this.snapshotListeners) {
          listener(message);
        }
      } catch (error) {
        this.publishState({
          kind: 'error',
          reason: toError(error, 'Host snapshot failed').message,
        });
        return;
      }
      this.hostInstanceId = message.status.hostInstanceId;
      this.lastSeq = message.currentSeq;
      this.pendingPushes.clear();
      this.replayInFlight = false;
      this.persistCursor();
      this.publishState({ kind: 'ready' });
      return;
    }

    if (message.type === 'hydration') {
      if (!isValidHydrationFrame(message)) {
        this.publishState({ kind: 'error', reason: 'Invalid Host hydration frame' });
        return;
      }
      try {
        for (const listener of this.hydrationListeners) {
          listener(message);
        }
      } catch (error) {
        this.publishState({
          kind: 'error',
          reason: toError(error, 'Host hydration failed').message,
        });
        return;
      }
      this.hostInstanceId = message.snapshot.hostInstanceId;
      this.lastSeq = message.snapshot.snapshotSeq;
      this.pendingPushes.clear();
      this.replayInFlight = false;
      this.persistCursor();
      this.publishState({ kind: 'ready' });
    }
  }

  private createHello(lastSeq: number): HostClientHello {
    const hello = {
      type: 'client/hello' as const,
      protocolVersion: HOST_PROTOCOL_VERSION,
      clientType: this.clientType,
      clientVersion: this.clientVersion,
      clientId: this.clientId,
      lastSeq,
      ...(this.hostInstanceId !== undefined ? { lastHostInstanceId: this.hostInstanceId } : {}),
      capabilities: this.capabilities,
      ...(this.subscriptions === undefined ? {} : { subscriptions: this.subscriptions }),
      ...(this.pairingToken === undefined || this.pairingToken.length === 0
        ? {}
        : { pairingToken: this.pairingToken }),
      ...(this.deviceCredential === undefined ? {} : { deviceCredential: this.deviceCredential }),
      ...(this.deviceName === undefined || this.deviceName.length === 0
        ? {}
        : { deviceName: this.deviceName }),
    };
    if (this.pairingToken !== undefined || this.deviceCredential !== undefined) {
      return hello;
    }
    return this.authToken === undefined ? hello : { ...hello, authToken: this.authToken };
  }

  private async adoptIssuedDeviceCredential(hello: HostHello): Promise<void> {
    if (hello.deviceId === undefined || hello.deviceSecret === undefined) {
      return;
    }
    const credential: TrustedDeviceCredential = {
      deviceId: hello.deviceId,
      deviceSecret: hello.deviceSecret,
    };
    this.deviceCredential = credential;
    this.pairingToken = undefined;
    this.authToken = undefined;
    if (this.onIssuedDeviceCredential !== undefined) {
      await this.onIssuedDeviceCredential(credential);
    }
  }

  private handlePush(frame: Extract<HostWireMessage, { type: 'push' }>): void {
    if (frame.seq <= this.lastSeq) {
      return;
    }

    if (frame.seq > this.lastSeq + 1) {
      this.pendingPushes.set(frame.seq, frame);
      const expectedSeq = this.lastSeq + 1;
      this.publishState({ kind: 'resync-required', expectedSeq, receivedSeq: frame.seq });
      this.sendReplayRequest();
      return;
    }

    if (this.applyPush(frame)) {
      this.flushPendingPushes();
    }
  }

  private applyPush(frame: HostPushFrame): boolean {
    try {
      for (const listener of this.pushListeners) {
        listener(frame.push, frame);
      }
    } catch (error) {
      this.publishState({ kind: 'error', reason: toError(error, 'Host push failed').message });
      return false;
    }
    this.lastSeq = frame.seq;
    this.persistCursor();
    return true;
  }

  private flushPendingPushes(): void {
    while (true) {
      const nextFrame = this.pendingPushes.get(this.lastSeq + 1);
      if (nextFrame === undefined) {
        return;
      }
      if (!this.applyPush(nextFrame)) {
        return;
      }
      this.pendingPushes.delete(nextFrame.seq);
    }
  }

  private handlePushBatch(frame: HostPushBatchFrame): void {
    if (this.hostHello !== undefined && frame.hostInstanceId !== this.hostHello.hostInstanceId) {
      this.publishState({
        kind: 'resync-required',
        expectedSeq: 0,
        receivedSeq: frame.throughSeq,
      });
      return;
    }
    if (!isValidPushBatch(frame)) {
      this.publishState({ kind: 'error', reason: 'Invalid Host push batch' });
      return;
    }
    if (frame.throughSeq <= this.lastSeq) {
      return;
    }
    if (frame.afterSeq !== this.lastSeq) {
      this.publishState({
        kind: 'resync-required',
        expectedSeq: this.lastSeq,
        receivedSeq: frame.afterSeq,
      });
      this.sendReplayRequest();
      return;
    }

    try {
      for (const listener of this.batchListeners) {
        listener(frame);
      }
      for (const item of frame.items) {
        const singularFrame: HostPushFrame = {
          type: 'push',
          seq: item.seq,
          eventId: item.eventId,
          push: item.push,
        };
        for (const listener of this.pushListeners) {
          listener(item.push, singularFrame);
        }
      }
    } catch (error) {
      this.publishState({
        kind: 'error',
        reason: toError(error, 'Host push batch failed').message,
      });
      return;
    }

    this.lastSeq = frame.throughSeq;
    this.hostInstanceId = frame.hostInstanceId;
    this.persistCursor();
  }

  private persistCursor(): void {
    this.lastSeqStore.write(this.lastSeq);
    this.cursorStore?.write(this.getCursor());
  }

  private handleTransportState(state: HostTransportState): void {
    if (state.kind === 'connecting') {
      this.publishState({ kind: 'connecting' });
    } else if (state.kind === 'closed') {
      if (!this.disposed) {
        this.rejectPendingRequests(state.reason ?? 'Host connection closed');
        const nextState =
          state.reason === undefined
            ? { kind: 'disconnected' as const }
            : { kind: 'disconnected' as const, reason: state.reason };
        this.publishState(nextState);
      }
    } else if (state.kind === 'error') {
      this.rejectPendingRequests(state.reason);
      this.publishState({ kind: 'error', reason: state.reason });
    }
  }

  private rejectPendingRequests(reason: string): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(requestId);
    }
  }

  private publishState(state: HostClientState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Host client has been closed');
    }
  }
}

function addCommandId(command: HostCommand, requestId: string): HostCommand {
  if (command.id !== undefined) {
    return command;
  }
  return { ...command, id: requestId } as HostCommand;
}

function createRequestId(prefix: string): string {
  const cryptoObject = (
    globalThis as unknown as {
      crypto?: { randomUUID?: () => string };
    }
  ).crypto;
  if (cryptoObject?.randomUUID !== undefined) {
    return `${prefix}-${cryptoObject.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createMemoryLastSeqStore(): HostClientLastSeqStore {
  let value = 0;
  return {
    read: () => value,
    write: (nextValue) => {
      value = nextValue;
    },
  };
}

function readLastSeq(store: HostClientLastSeqStore): number {
  const value = store.read();
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isValidPushBatch(frame: HostPushBatchFrame): boolean {
  if (!Number.isSafeInteger(frame.afterSeq) || frame.afterSeq < 0) return false;
  if (!Number.isSafeInteger(frame.throughSeq) || frame.throughSeq < frame.afterSeq) return false;
  if (frame.hostInstanceId.trim().length === 0) return false;

  let previousSeq = frame.afterSeq;
  for (const item of frame.items) {
    if (
      !Number.isSafeInteger(item.seq) ||
      item.seq <= previousSeq ||
      item.seq > frame.throughSeq ||
      item.eventId.trim().length === 0
    ) {
      return false;
    }
    if (item.push.seq !== undefined && item.push.seq !== item.seq) return false;
    if (item.push.eventId !== undefined && item.push.eventId !== item.eventId) return false;
    previousSeq = item.seq;
  }
  return true;
}

function isValidHydrationFrame(frame: HostHydrationFrame): boolean {
  const snapshot = frame.snapshot;
  return (
    (frame.reason === 'replay-too-old' ||
      frame.reason === 'host-instance-changed' ||
      frame.reason === 'requested') &&
    snapshot.snapshotId.trim().length > 0 &&
    snapshot.hostInstanceId.trim().length > 0 &&
    Number.isSafeInteger(snapshot.snapshotSeq) &&
    snapshot.snapshotSeq >= 0 &&
    Array.isArray(snapshot.sessions) &&
    typeof snapshot.messagesBySession === 'object' &&
    snapshot.messagesBySession !== null &&
    Array.isArray(snapshot.truncatedSessionIds)
  );
}

function countAdmissionKeys(options: HostClientOptions): number {
  return (
    Number(options.authToken !== undefined && options.authToken.length > 0) +
    Number(options.pairingToken !== undefined && options.pairingToken.trim().length > 0) +
    Number(options.deviceCredential !== undefined)
  );
}

function normalizeSubscriptions(
  subscriptions: HostClientSubscriptions | undefined,
): HostClientSubscriptions | undefined {
  const sessionIds = subscriptions?.sessionIds;
  if (!Array.isArray(sessionIds)) return undefined;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const sessionId of sessionIds) {
    if (
      typeof sessionId !== 'string' ||
      sessionId.trim().length === 0 ||
      sessionId.length > 256 ||
      seen.has(sessionId)
    ) {
      continue;
    }
    normalized.push(sessionId);
    seen.add(sessionId);
    if (normalized.length >= 4) break;
  }
  return normalized.length === 0 ? undefined : { sessionIds: normalized };
}

function getSmallestPendingSeq(pendingPushes: Map<number, HostPushFrame>): number {
  let smallest = Number.MAX_SAFE_INTEGER;
  for (const sequence of pendingPushes.keys()) {
    smallest = Math.min(smallest, sequence);
  }
  return smallest === Number.MAX_SAFE_INTEGER ? 0 : smallest;
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
