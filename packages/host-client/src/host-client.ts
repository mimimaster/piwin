import type {
  ClientToolCancelFrame,
  ClientToolCapabilitiesFrame,
  ClientToolCapabilityAdvertisement,
  ClientToolRequestFrame,
  ClientToolResultFrame,
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
  HostSubscriptionsAppliedFrame,
  HostWireErrorCode,
  HostWireMessage,
  TrustedDeviceCredential,
} from '@piwin/contracts';
import {
  HOST_PROTOCOL_VERSION,
  isTrustedDeviceCredential,
  normalizeDecodedAgentEvent,
  remoteCommandRequiresIdempotencyKey,
  remoteHostSupportsCommand,
} from '@piwin/contracts';
import type {
  HostTransport,
  HostTransportBinaryListener,
  HostTransportState,
} from '@piwin/host-transport';
import {
  addCommandId,
  countAdmissionKeys,
  createMemoryLastSeqStore,
  createRequestId,
  getSmallestPendingSeq,
  isValidHydrationFrame,
  isValidPushBatch,
  normalizeSubscriptions,
  omitClientTools,
  readLastSeq,
  toError,
} from './host-client-helpers.js';

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

export type HostClientToolRequestListener = (frame: ClientToolRequestFrame) => void;

export type HostClientToolCancelListener = (frame: ClientToolCancelFrame) => void;

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

/** Out-of-order push frames held until the missing seq arrives. Unbounded this retained whole journals. */
export const MAX_PENDING_PUSH_FRAMES = 256;

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
    ((credential: TrustedDeviceCredential) => Promise<void> | void) | undefined;
  private readonly lastSeqStore: HostClientLastSeqStore;
  private readonly cursorStore: HostClientCursorStore | undefined;
  private capabilities: HostClientCapabilities;
  private subscriptions: HostClientSubscriptions | undefined;
  private subscriptionRevision = 0;
  private readonly pendingSubscriptionUpdates = new Map<
    string,
    {
      resolve: (frame: HostSubscriptionsAppliedFrame) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly requestTimeoutMs: number;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly stateListeners = new Set<HostClientStateListener>();
  private readonly pushListeners = new Set<HostClientPushListener>();
  private readonly batchListeners = new Set<HostClientBatchListener>();
  private readonly snapshotListeners = new Set<HostClientSnapshotListener>();
  private readonly hydrationListeners = new Set<HostClientHydrationListener>();
  private readonly binaryListeners = new Set<HostTransportBinaryListener>();
  private readonly clientToolRequestListeners = new Set<HostClientToolRequestListener>();
  private readonly clientToolCancelListeners = new Set<HostClientToolCancelListener>();
  private readonly pendingPushes = new Map<number, HostPushFrame>();
  private readonly unsubscribeTransport: () => void;
  private readonly unsubscribeTransportState: () => void;
  private readonly unsubscribeTransportBinary: () => void;
  private state: HostClientState = { kind: 'idle' };
  private hostHello: HostHello | undefined;
  private lastSeq: number;
  private hostInstanceId: string | undefined;
  private replayInFlight = false;
  private replayRequestId: string | undefined;
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
    if (
      options.deviceCredential !== undefined &&
      !isTrustedDeviceCredential(options.deviceCredential)
    ) {
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
    // Hello must always use HostClient's cursor — Transport's copy is a cache
    // updated via persistCursor, not an independent authority.
    this.transport.setHelloFactory(() => this.createHello(this.lastSeq));
    this.transport.setLastSeq(this.lastSeq);
    this.unsubscribeTransport = this.transport.subscribe((message) => this.handleMessage(message));
    this.unsubscribeTransportState = this.transport.subscribeState((state) =>
      this.handleTransportState(state),
    );
    this.unsubscribeTransportBinary =
      this.transport.subscribeBinary?.((bytes) => {
        for (const listener of this.binaryListeners) listener(bytes);
      }) ?? (() => undefined);
  }

  public getState(): HostClientState {
    return this.state;
  }

  public getClientId(): string {
    return this.clientId;
  }

  public getHostHello(): HostHello | undefined {
    return this.hostHello;
  }

  /** Omitted hello ceiling means operator: every command. A present list is a ceiling. */
  public supportsCommand(type: HostCommand['type']): boolean {
    return remoteHostSupportsCommand(this.hostHello?.capabilities.allowedCommands, type);
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

  /** Out-of-band browser JPEG frames (spec §4.1.2). Local JSONL never fires. */
  public subscribeBinary(listener: HostTransportBinaryListener): () => void {
    this.binaryListeners.add(listener);
    return () => this.binaryListeners.delete(listener);
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

  public subscribeClientToolRequests(listener: HostClientToolRequestListener): () => void {
    this.clientToolRequestListeners.add(listener);
    return () => this.clientToolRequestListeners.delete(listener);
  }

  public subscribeClientToolCancellations(listener: HostClientToolCancelListener): () => void {
    this.clientToolCancelListeners.add(listener);
    return () => this.clientToolCancelListeners.delete(listener);
  }

  public supportsClientToolRequests(): boolean {
    return this.hostHello?.capabilities.clientToolRequests === true;
  }

  public sendClientToolResult(frame: ClientToolResultFrame): void {
    this.assertClientToolOutboundReady();
    this.transport.send(frame);
  }

  public replaceClientToolCapabilities(
    capabilities: readonly ClientToolCapabilityAdvertisement[],
  ): void {
    this.assertClientToolOutboundReady();
    const frame: ClientToolCapabilitiesFrame = {
      type: 'client-tool/capabilities',
      capabilities,
      sentAt: new Date().toISOString(),
    };
    this.capabilities =
      capabilities.length === 0
        ? omitClientTools(this.capabilities)
        : { ...this.capabilities, clientTools: capabilities };
    this.transport.send(frame);
  }

  public async connect(): Promise<HostHello> {
    this.assertNotDisposed();
    this.publishState({ kind: 'connecting' });
    this.transport.setLastSeq(this.lastSeq);
    try {
      const hello = await this.transport.connect();
      this.hostHello = hello;
      await this.adoptIssuedDeviceCredential(hello);
      // Wire admission is hello. Journal catch-up must not block connect() or
      // shells paint "connecting" for the whole replay/snapshot window and
      // refuse gestures that the socket can already carry.
      this.armCatchUpWatch();
      return hello;
    } catch (error) {
      const connectionError = toError(error, 'Unable to connect to Host');
      this.publishState({ kind: 'error', reason: connectionError.message });
      // Hello failure must not leave an open socket that neither serves
      // requests nor auto-reconnects under `error` state.
      await this.transport.close().catch(() => undefined);
      throw connectionError;
    }
  }

  public async close(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clientToolRequestListeners.clear();
    this.clientToolCancelListeners.clear();
    this.unsubscribeTransport();
    this.unsubscribeTransportState();
    this.unsubscribeTransportBinary();
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Host client closed'));
      this.pendingRequests.delete(requestId);
    }
    for (const [requestId, pending] of this.pendingSubscriptionUpdates) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Host client closed'));
      this.pendingSubscriptionUpdates.delete(requestId);
    }
    await this.transport.close();
    this.publishState({ kind: 'disconnected' });
  }

  public request(command: HostCommand, options: HostRequestOptions = {}): Promise<HostResponse> {
    this.assertNotDisposed();
    if (!this.supportsCommand(command.type)) {
      return Promise.resolve({
        ...(command.id === undefined ? {} : { id: command.id }),
        type: 'response',
        command: command.type,
        success: false,
        error: `This Host does not expose ${command.type} to remote clients`,
      });
    }
    const requestId = createRequestId('request');
    const commandWithId = addCommandId(command, requestId);
    const idempotencyKey = options.idempotencyKey?.trim();
    if (remoteCommandRequiresIdempotencyKey(commandWithId.type) && !idempotencyKey) {
      return Promise.resolve({
        ...(command.id === undefined ? {} : { id: command.id }),
        type: 'response',
        command: commandWithId.type,
        success: false,
        error: 'idempotency-key-required',
        problem: { code: 'idempotency-key-required' },
      });
    }
    const frame =
      idempotencyKey === undefined || idempotencyKey.length === 0
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

  /** Foreground / network-change hint for the transport; see `HostTransport.wake`. */
  public wake(): boolean {
    if (this.disposed) {
      return false;
    }
    return this.transport.wake?.() ?? false;
  }

  public requestReplay(): void {
    this.assertNotDisposed();
    this.sendReplayRequest();
  }

  public updateSubscriptions(sessionIds: string[]): Promise<HostSubscriptionsAppliedFrame> {
    this.assertNotDisposed();
    const normalized = normalizeSubscriptions({ sessionIds });
    this.subscriptions = normalized;
    this.subscriptionRevision += 1;
    const requestId = createRequestId('sub');
    const frame = {
      type: 'client/subscriptions' as const,
      requestId,
      revision: this.subscriptionRevision,
      subscriptions: normalized ?? { sessionIds: [] },
    };
    const timeoutMs = this.requestTimeoutMs;
    return new Promise<HostSubscriptionsAppliedFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSubscriptionUpdates.delete(requestId);
        reject(new Error('Host subscription update timed out'));
      }, timeoutMs);
      this.pendingSubscriptionUpdates.set(requestId, { resolve, reject, timer });
      try {
        this.transport.send(frame);
      } catch (error) {
        clearTimeout(timer);
        this.pendingSubscriptionUpdates.delete(requestId);
        reject(toError(error, 'Unable to send Host subscription update'));
      }
    });
  }

  /**
   * Catch-up is best-effort after hello. Never close a live socket here —
   * that painted "connecting" on a workbench that was already listing sessions.
   */
  private armCatchUpWatch(): void {
    void this.waitUntilCatchUp().catch(() => {
      if (this.disposed || this.state.kind === 'ready' || this.state.kind === 'error') {
        return;
      }
      this.sendReplayRequest();
    });
  }

  private waitUntilCatchUp(): Promise<void> {
    if (this.state.kind === 'ready') {
      return Promise.resolve();
    }
    if (this.state.kind === 'error') {
      return Promise.reject(new Error(this.state.reason));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error('Timed out waiting for Host catch-up after hello'));
      }, this.requestTimeoutMs);
      const unsubscribe = this.subscribeState((state) => {
        if (state.kind === 'ready') {
          clearTimeout(timer);
          unsubscribe();
          resolve();
          return;
        }
        if (state.kind === 'error') {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error(state.reason));
          return;
        }
        if (state.kind === 'disconnected') {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error(state.reason ?? 'Host disconnected during catch-up'));
        }
      });
    });
  }

  private sendReplayRequest(): void {
    if (this.replayInFlight) {
      return;
    }
    const requestId = createRequestId('replay');
    const frame = {
      type: 'replay' as const,
      requestId,
      sinceSeq: this.lastSeq,
    };
    this.replayInFlight = true;
    this.replayRequestId = requestId;
    try {
      this.transport.send(frame);
    } catch (error) {
      this.replayInFlight = false;
      this.replayRequestId = undefined;
      this.publishState({
        kind: 'error',
        reason: toError(error, 'Unable to request Host replay').message,
      });
    }
  }

  private handleMessage(message: HostWireMessage): void {
    if (message.type === 'client-tool/request') {
      for (const listener of this.clientToolRequestListeners) {
        listener(message);
      }
      return;
    }
    if (message.type === 'client-tool/cancel') {
      for (const listener of this.clientToolCancelListeners) {
        listener(message);
      }
      return;
    }
    if (message.type === 'client-tool/result' || message.type === 'client-tool/capabilities') {
      return;
    }

    if (message.type === 'host/hello') {
      const hostChanged =
        this.hostInstanceId !== undefined && this.hostInstanceId !== message.hostInstanceId;
      this.hostHello = message;
      if (hostChanged) {
        this.lastSeq = 0;
        this.pendingPushes.clear();
        this.replayInFlight = false;
        this.replayRequestId = undefined;
      }
      // Future cursor vs a restarted Host with the same advertised id: clamp so
      // we do not filter every new push as already-seen.
      if (message.currentSeq < this.lastSeq) {
        this.lastSeq = message.currentSeq;
        this.pendingPushes.clear();
        this.replayInFlight = false;
        this.replayRequestId = undefined;
      }
      this.hostInstanceId = message.hostInstanceId;
      this.persistCursor();
      // Stay connecting until replay/done | snapshot | hydration marks catch-up.
      if (this.state.kind !== 'ready') {
        this.publishState({ kind: 'connecting' });
      }
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
      if (
        this.replayRequestId !== undefined &&
        (message.requestId === undefined || message.requestId === this.replayRequestId)
      ) {
        this.replayInFlight = false;
        this.replayRequestId = undefined;
      }
      if (message.requestId === undefined) {
        // Handshake / decode faults before hello may take the client down.
        // After hello the socket is admitted; an uncorrelated error must not
        // paint the shell "connecting" while commands are still in flight.
        if (this.hostHello === undefined) {
          this.publishState({ kind: 'error', reason: message.message });
        }
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
      this.replayRequestId = undefined;
      // `currentSeq` is the server-side cursor fence, not merely the last
      // record visible through this client's live subscription. During replay
      // the Host advances its egress channel across filtered tail records
      // before unpausing live delivery. Adopt the same fence or the next valid
      // cursor batch has `afterSeq > lastSeq`, which starts an endless
      // replay/resync loop and leaves live Agent deltas unapplied.
      if (message.currentSeq > this.lastSeq) {
        this.lastSeq = message.currentSeq;
        for (const sequence of this.pendingPushes.keys()) {
          if (sequence <= message.currentSeq) {
            this.pendingPushes.delete(sequence);
          }
        }
        this.persistCursor();
      }
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
      this.replayRequestId = undefined;
      this.persistCursor();
      this.publishState({ kind: 'ready' });
      return;
    }

    if (message.type === 'subscriptions/applied') {
      const pending = this.pendingSubscriptionUpdates.get(message.requestId);
      if (pending === undefined) {
        return;
      }
      clearTimeout(pending.timer);
      this.pendingSubscriptionUpdates.delete(message.requestId);
      pending.resolve(message);
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
      this.replayRequestId = undefined;
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
      if (this.pendingPushes.size >= MAX_PENDING_PUSH_FRAMES) {
        this.pendingPushes.clear();
        this.publishState({
          kind: 'resync-required',
          expectedSeq: this.lastSeq + 1,
          receivedSeq: frame.seq,
        });
        this.sendReplayRequest();
        return;
      }
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
      const push = normalizeHostPushFailures(frame.push);
      const normalizedFrame = push === frame.push ? frame : { ...frame, push };
      for (const listener of this.pushListeners) {
        listener(normalizedFrame.push, normalizedFrame);
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

  private assertClientToolOutboundReady(): void {
    this.assertNotDisposed();
    if (this.state.kind !== 'ready' || this.hostHello?.authenticated !== true) {
      throw new Error('Client tool frames require an authenticated ready Host connection');
    }
    if (this.hostHello.capabilities.clientToolRequests !== true) {
      throw new Error('This Host does not support client-tool requests');
    }
  }

  private persistCursor(): void {
    // Always keep Transport's reconnect hello in sync with the in-memory cursor,
    // even when durable stores fail (quota / private mode).
    this.transport.setLastSeq(this.lastSeq);
    try {
      this.lastSeqStore.write(this.lastSeq);
      this.cursorStore?.write(this.getCursor());
    } catch {
      // Soft-fail: do not publish `error` or the shell goes sticky-dead while
      // the socket is still open and Desktop refuses non-ready requests.
    }
  }

  private handleTransportState(state: HostTransportState): void {
    if (state.kind === 'connecting') {
      // Drop the previous hello so shells do not treat dial-in-progress as
      // admitted on a stale credential from the last socket.
      this.hostHello = undefined;
      this.publishState({ kind: 'connecting' });
    } else if (state.kind === 'closed') {
      if (!this.disposed) {
        this.hostHello = undefined;
        this.rejectPendingRequests(state.reason ?? 'Host connection closed');
        const nextState =
          state.reason === undefined
            ? { kind: 'disconnected' as const }
            : { kind: 'disconnected' as const, reason: state.reason };
        this.publishState(nextState);
      }
    } else if (state.kind === 'error') {
      this.hostHello = undefined;
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
    for (const [requestId, pending] of this.pendingSubscriptionUpdates) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingSubscriptionUpdates.delete(requestId);
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

function normalizeHostPushFailures(push: HostPush): HostPush {
  if (push.type !== 'event' && push.type !== 'subagent/stream') {
    return push;
  }
  const event = normalizeDecodedAgentEvent(push.event);
  return event === push.event ? push : { ...push, event };
}
