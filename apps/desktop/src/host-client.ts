import type {
  BrowserInputEvent,
  HostCommand,
  HostHello,
  HostMode,
  HostPush,
  HostPushBatchFrame,
  HostResponse,
  HostServerMessage,
  LocalMobileAccessCommand,
  RemoteCapabilitySummary,
} from '@piwin/contracts';
import {
  formatError,
  HOST_COMMAND_REQUEST_ENVELOPE_VERSION,
  isLocalMobileAccessCommandType,
  remoteCommandRequiresIdempotencyKey,
  remoteHostSupportsCommand,
} from '@piwin/contracts';
import { readDesktopClientPrincipalId } from './desktop-client-principal.js';
import { MOBILE_ACCESS_SIDECAR_ONLY_ERROR } from './mobile-access-local';
import type { MockHostBackend } from './host-client-mock';
import {
  isHostPushBatchFrame,
  isReplayDoneFrame,
  isSafeSequence,
} from './host-push-frame.js';
import {
  createDesktopRemoteHostClient,
  readRemoteHostInstanceId,
  registerLiveDesktopRemoteHost,
  type DesktopRemoteHostTarget,
} from './remote-host-session';

export type HostClientListener = (message: HostServerMessage) => void;

export type HostClientOptions = {
  /**
   * true  → in-browser mock (Vite only)
   * false → Tauri sidecar `piwin host serve` JSONL bridge
   * 'auto'→ mock outside Tauri, live inside Tauri
   * 'remote' → standalone Host over WebSocket (never touches the JSONL sidecar)
   */
  transport?: boolean | 'auto' | 'mock' | 'live' | 'remote';
  /** When using live transport, start host with --mock (agent mock, not UI mock). Default true for scaffold. */
  hostMock?: boolean;
  remoteTarget?: DesktopRemoteHostTarget;
};

type TransportMode = 'mock' | 'live' | 'remote';

const HOST_REQUEST_ACK_TIMEOUT_MS = 5_000;
/**
 * Remote WebSocket acks share the Host event loop with hello replay and
 * first-boot journal recovery. Five seconds is the sidecar JSONL budget;
 * remote needs a wider one or Send paints a timeout while Host is still
 * accepting the run.
 */
const REMOTE_HOST_REQUEST_ACK_TIMEOUT_MS = 30_000;
/**
 * A zero timeout tells the Tauri bridge to wait until the Host responds.
 * Compaction is a model completion, not an acknowledgement: its explicit
 * abort command is the bounded control path.
 */
const HOST_REQUEST_NO_TIMEOUT_MS = 0;
const HOST_REQUEST_STATUS_TIMEOUT_MS = 3_000;
const REMOTE_HOST_REQUEST_STATUS_TIMEOUT_MS = 15_000;
const HOST_REQUEST_QUERY_TIMEOUT_MS = 15_000;
const HOST_REQUEST_OPERATION_TIMEOUT_MS = 120_000;
const HOST_REQUEST_IMAGE_GENERATION_TIMEOUT_MS = 360_000;
const HOST_REQUEST_NETWORK_QUERY_TIMEOUT_MS = 30_000;

function getHostRequestTimeoutMs(
  command: HostCommand | LocalMobileAccessCommand,
  transport: TransportMode = 'live',
): number {
  if (isLocalMobileAccessCommandType(command.type)) {
    return HOST_REQUEST_QUERY_TIMEOUT_MS;
  }
  const remote = transport === 'remote';
  switch (command.type) {
    case 'session/compact':
    case 'session/compact-export':
      return HOST_REQUEST_NO_TIMEOUT_MS;
    case 'session/prompt':
    case 'session/abort':
    case 'session/pause':
    case 'session/resume-run':
    case 'session/compact-abort':
    case 'session/steer':
    case 'session/follow_up':
    case 'run/intervention-submit':
    case 'run/intervention-edit':
    case 'run/intervention-cancel':
    case 'session/queued-turn-submit':
    case 'session/queued-turn-edit':
    case 'session/queued-turn-cancel':
    case 'session/queued-turn-reorder':
    case 'session/replace-run':
    case 'permission/resolve':
    case 'extension/ui_resolve':
    case 'project/authorize-terminal':
      return remote ? REMOTE_HOST_REQUEST_ACK_TIMEOUT_MS : HOST_REQUEST_ACK_TIMEOUT_MS;
    case 'host/ping':
    case 'host/status':
      return remote ? REMOTE_HOST_REQUEST_STATUS_TIMEOUT_MS : HOST_REQUEST_STATUS_TIMEOUT_MS;
    case 'models/discover':
    case 'models/test':
    case 'voice/live/start':
    case 'speech/transcribe':
    case 'mcp/start':
    case 'mcp/stop':
    case 'skills/install':
    case 'extensions/install':
    case 'extensions/apply':
    case 'plugins/install':
    case 'plugins/uninstall':
    case 'plugins/registry/list':
    case 'session/cold-storage-execute':
    case 'session/cold-storage-restore':
    case 'session/cold-storage-import':
    case 'theme/install-local':
    case 'pet/scan-local':
    case 'pet/install-local':
    case 'pet/install-local-batch':
    case 'pet/install-registry':
      return HOST_REQUEST_OPERATION_TIMEOUT_MS;
    case 'models/image-test':
      return HOST_REQUEST_IMAGE_GENERATION_TIMEOUT_MS;
    case 'pet/store-query':
      return HOST_REQUEST_NETWORK_QUERY_TIMEOUT_MS;
    default:
      return HOST_REQUEST_QUERY_TIMEOUT_MS;
  }
}

function detectTransport(options: HostClientOptions): TransportMode {
  const requested = options.transport ?? 'auto';
  if (requested === 'mock' || requested === true) {
    return 'mock';
  }
  if (requested === 'live' || requested === false) {
    return 'live';
  }
  if (requested === 'remote') {
    return 'remote';
  }
  return isTauriRuntime() ? 'live' : 'mock';
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Frontend host client. Never imports Pi.
 * - mock: {@link MockHostBackend}
 * - live: Tauri commands → Node `host serve` JSONL sidecar
 * - remote: `@piwin/host-client` over WebSocket; never invokes the JSONL bridge
 */
/**
 * A push batch arrived whose `afterSeq` is beyond the applied cursor: frames
 * between the cursor and the batch never reached the WebView. Detected on the
 * local Stage 1 bridge too, where a dropped JSONL line otherwise heals over
 * silently (ADR 0038 §9).
 */
export type HostPushSequenceGap = {
  hostInstanceId: string;
  /** First sequence number we can no longer account for. */
  missedFromSeq: number;
  /** First sequence number this batch proved arrived. */
  receivedFromSeq: number;
};

export type HostSequenceGapHandler = (gap: HostPushSequenceGap) => void;

export class HostClient {
  private readonly listeners = new Set<HostClientListener>();
  private readonly transport: TransportMode;
  private readonly hostMock: boolean;
  private readonly remoteTarget: DesktopRemoteHostTarget | undefined;
  private mode: HostMode = 'sdk';
  private ready = false;
  private requestCounter = 0;
  private unlistenHostMessage: (() => void) | null = null;
  private unlistenHostMessageBatch: (() => void) | null = null;
  private unlistenHostLog: (() => void) | null = null;
  private unlistenHostStatus: (() => void) | null = null;
  /** Stage 1 local egress cursor, scoped to the current host process. */
  private hostInstanceId: string | null = null;
  private lastHostSeq = 0;
  /** Prevent Strict Mode/HMR from registering the Tauri event bridge twice. */
  private pendingConnection: Promise<void> | null = null;
  private mockBackend: MockHostBackend | null = null;
  private pendingMockBackend: Promise<MockHostBackend> | null = null;
  private sequenceGapHandler: HostSequenceGapHandler | null = null;
  private remoteClient: ReturnType<typeof createDesktopRemoteHostClient> | null = null;
  private unsubscribeRemote: (() => void) | null = null;
  private unsubscribeLiveRemote: (() => void) | null = null;
  /** True after the first remote connect attempt; later `ready` is a reconnect. */
  private remoteInitialConnectDone = false;
  private remoteRestoreInFlight = false;
  private remoteCapabilities: RemoteCapabilitySummary | undefined;

  constructor(options: HostClientOptions = {}) {
    this.transport = detectTransport(options);
    this.hostMock = options.hostMock !== false;
    this.remoteTarget = options.remoteTarget;
    // Settings (and others) extract `hostClient.request`. An unbound class
    // method throws on `this.transport` and the click never leaves the UI.
    this.request = this.request.bind(this);
  }

  getTransport(): TransportMode {
    return this.transport;
  }

  getRemoteTarget(): DesktopRemoteHostTarget | undefined {
    return this.remoteTarget;
  }

  getRemoteCapabilities(): RemoteCapabilitySummary | undefined {
    return this.remoteCapabilities;
  }

  getHostInstanceId(): string | null {
    return this.hostInstanceId;
  }

  /** Local transports expose the full Host contract; remote uses the negotiated command ceiling. */
  supportsCommand(type: HostCommand['type']): boolean {
    if (this.transport !== 'remote') {
      return true;
    }
    return remoteHostSupportsCommand(this.remoteCapabilities?.allowedCommands, type);
  }

  /** Local JSONL / mock may always send. Remote requires hello.foregroundRunAdmission. */
  supportsForegroundAdmission(): boolean {
    return this.transport !== 'remote' || this.remoteCapabilities?.foregroundRunAdmission === true;
  }

  updateSubscriptions(sessionIds: string[]): Promise<void> {
    if (this.transport !== 'remote') {
      return Promise.resolve();
    }
    return this.getOrCreateRemoteClient()
      .updateSubscriptions(sessionIds)
      .then(() => undefined);
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Register (or clear) the push-sequence gap handler. Gaps mean pushes were
   * lost in transit; the handler is expected to resync from Host authority.
   */
  registerSequenceGapHandler(handler: HostSequenceGapHandler | null): void {
    this.sequenceGapHandler = handler;
  }

  subscribe(listener: HostClientListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    // Idempotent: HMR / Strict Mode remounts re-enter bootstrap without dispose.
    if (
      this.ready &&
      ((this.transport === 'live' && this.unlistenHostMessage) ||
        (this.transport === 'remote' && this.remoteClient))
    ) {
      this.emit({
        type: 'host/status',
        mode: this.mode,
        ready: true,
        mock: this.hostMock,
      });
      return;
    }

    if (this.pendingConnection) {
      return this.pendingConnection;
    }

    const connection = this.connectTransport();
    this.pendingConnection = connection;
    try {
      await connection;
    } finally {
      if (this.pendingConnection === connection) {
        this.pendingConnection = null;
      }
    }
  }

  private async connectTransport(): Promise<void> {
    if (this.transport === 'mock') {
      await this.getMockBackend();
      this.ready = true;
      this.emit({
        type: 'host/status',
        mode: this.mode,
        ready: true,
        mock: true,
      });
      return;
    }

    if (this.transport === 'remote') {
      await this.connectRemoteTransport();
      return;
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');

    if (this.unlistenHostMessage) {
      this.unlistenHostMessage();
      this.unlistenHostMessage = null;
    }
    if (this.unlistenHostMessageBatch) {
      this.unlistenHostMessageBatch();
      this.unlistenHostMessageBatch = null;
    }
    if (this.unlistenHostLog) {
      this.unlistenHostLog();
      this.unlistenHostLog = null;
    }
    if (this.unlistenHostStatus) {
      this.unlistenHostStatus();
      this.unlistenHostStatus = null;
    }

    this.unlistenHostStatus = await listen<{ state: string; attempt?: number }>(
      'host-status',
      (event) => {
        const { state } = event.payload;
        // Rust supervisor emits "reconnecting" / "restarted" / "fatal".
        // On reconnecting, flip ready=false so the UI shows the reconnecting
        // pill; on restarted, the new host's host/status push will flip it
        // back to true; on fatal, keep ready=false so the UI shows offline.
        if (state === 'reconnecting' || state === 'fatal') {
          this.ready = false;
          this.emit({
            type: 'host/status',
            mode: this.mode,
            ready: false,
            mock: this.hostMock,
          });
        }
      },
    );

    this.unlistenHostMessage = await listen<HostServerMessage>('host-message', (event) => {
      const rawPayload = event.payload as unknown;
      if (isReplayDoneFrame(rawPayload)) {
        this.adoptHostCursorFence(rawPayload.currentSeq);
        return;
      }
      // Responses are returned through request(); only unsolicited pushes are
      // broadcast to UI subscribers. Broadcasting responses as pushes makes a
      // failed request surface once in the caller and again in bootstrap.
      if (event.payload.type !== 'response') {
        this.emit(event.payload);
      }
      if (event.payload.type === 'host/status') {
        this.ready = event.payload.ready;
        this.mode = event.payload.mode;
      }
      if (event.payload.type === 'snapshot') {
        this.adoptHostCursorFence(event.payload.currentSeq);
      }
    });

    // Rust emits one event for each bounded egress batch. The batch is applied
    // as one cursor transaction; compatibility subscribers still receive the
    // contained semantic pushes in canonical order.
    this.unlistenHostMessageBatch = await listen<HostPushBatchFrame>(
      'host-message-batch',
      (event) => {
        this.emitBatch(event.payload);
      },
    );

    this.unlistenHostLog = await listen<{ level: string; message: string }>('host-log', (event) => {
      const level = event.payload.level;
      const message = event.payload.message;
      const normalizedLevel =
        level === 'error' || level === 'warn' || level === 'info' ? level : 'info';
      // Surface bridge-side logs to UI subscribers (HostLogPanel), not only console.
      this.emit({
        type: 'host/log',
        level: normalizedLevel,
        message,
      });
      if (level === 'error') {
        console.error('[host]', message);
      } else if (level === 'warn') {
        console.warn('[host]', message);
      } else {
        console.info('[host]', message);
      }
    });

    await invoke('host_start', { mock: this.hostMock });
    // host serve emits host/status immediately; also probe
    const status = await this.request({ type: 'host/status' });
    if (status.success) {
      this.ready = true;
      const data = status.data as { mode?: HostMode; mock?: boolean; ready?: boolean } | undefined;
      this.mode = data?.mode === 'rpc' ? 'rpc' : 'sdk';
      // Mirror request success as a status push so UI listeners stay in sync even if
      // the process startup push was missed during remount / race windows.
      this.emit({
        type: 'host/status',
        mode: this.mode,
        ready: data?.ready !== false,
        mock: data?.mock === true,
      });
    } else {
      this.ready = false;
      this.emit({
        type: 'host/log',
        level: 'error',
        message: status.error,
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.unlistenHostMessage) {
      this.unlistenHostMessage();
      this.unlistenHostMessage = null;
    }
    if (this.unlistenHostMessageBatch) {
      this.unlistenHostMessageBatch();
      this.unlistenHostMessageBatch = null;
    }
    if (this.unlistenHostLog) {
      this.unlistenHostLog();
      this.unlistenHostLog = null;
    }
    if (this.unlistenHostStatus) {
      this.unlistenHostStatus();
      this.unlistenHostStatus = null;
    }

    if (this.unsubscribeRemote) {
      this.unsubscribeRemote();
      this.unsubscribeRemote = null;
    }
    if (this.unsubscribeLiveRemote) {
      this.unsubscribeLiveRemote();
      this.unsubscribeLiveRemote = null;
    }
    const remoteClient = this.remoteClient;
    this.remoteClient = null;
    if (remoteClient) {
      try {
        await remoteClient.close();
      } catch (error) {
        console.warn('remote host close failed', error);
      }
    }

    if (this.transport === 'live' && isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('host_stop');
      } catch (error) {
        console.warn('host_stop failed', error);
      }
    }

    this.listeners.clear();
    this.mockBackend?.clear();
    this.ready = false;
    this.remoteInitialConnectDone = false;
    this.remoteRestoreInFlight = false;
    this.remoteCapabilities = undefined;
  }

  async request(
    command: HostCommand | LocalMobileAccessCommand,
    options: { idempotencyKey?: string } = {},
  ): Promise<HostResponse> {
    const id = command.id ?? `ui-${++this.requestCounter}`;
    const withId = { ...command, id };
    const idempotencyKey = options.idempotencyKey?.trim() || undefined;
    if (
      (this.transport === 'remote' || this.transport === 'live') &&
      !isLocalMobileAccessCommandType(command.type) &&
      remoteCommandRequiresIdempotencyKey(command.type) &&
      (idempotencyKey === undefined || idempotencyKey.length === 0)
    ) {
      return {
        type: 'response',
        command: command.type,
        success: false,
        error: 'idempotency-key-required',
        problem: { code: 'idempotency-key-required' },
        id,
      };
    }

    if (isLocalMobileAccessCommandType(command.type) && this.transport !== 'live') {
      return {
        type: 'response',
        command: command.type,
        success: false,
        error: MOBILE_ACCESS_SIDECAR_ONLY_ERROR,
        id,
      };
    }

    if (this.transport === 'mock') {
      const mockBackend = await this.getMockBackend();
      return mockBackend.handle(withId as HostCommand, id);
    }

    if (this.transport === 'remote') {
      if (!this.supportsCommand(withId.type as HostCommand['type'])) {
        return {
          type: 'response',
          command: withId.type,
          success: false,
          error: `This Host does not expose ${withId.type} to remote clients`,
          id,
        };
      }
      return this.requestFromRemoteHost(
        withId as HostCommand,
        idempotencyKey === undefined ? {} : { idempotencyKey },
      );
    }

    // Return host errors unchanged. Retrying after a string-matched error can
    // repeat state mutations or control commands against a restarted sidecar.
    return this.requestFromLiveHost(
      withId,
      idempotencyKey === undefined ? {} : { idempotencyKey },
    );
  }

  private async connectRemoteTransport(): Promise<void> {
    if (this.remoteTarget === undefined) {
      this.ready = false;
      this.emit({
        type: 'host/log',
        level: 'error',
        message: 'Remote Host target is not configured',
      });
      return;
    }

    const remote = this.getOrCreateRemoteClient();
    // Reconnect handlers must unblock the shell on hello even when the first
    // bootstrap connect() is still awaiting a slow Tauri dial.
    this.remoteInitialConnectDone = true;
    try {
      const hello = await remote.connect();
      this.rememberRemoteHello(hello);
      // Hello means the socket is admitted. A slow host/status (first-boot
      // journal, hello replay) must not keep the shell on "connecting" while
      // prompts are already running on that same socket.
      this.markRemoteAvailable();
    } catch (error) {
      this.emit({
        type: 'host/log',
        level: 'warn',
        message: formatError(error),
      });
    }
    await this.refreshRemoteStatus();
  }

  private async restoreRemoteReady(): Promise<void> {
    if (this.remoteRestoreInFlight) {
      return;
    }
    this.remoteRestoreInFlight = true;
    try {
      this.markRemoteAvailable();
      await this.refreshRemoteStatus();
    } finally {
      this.remoteRestoreInFlight = false;
    }
  }

  /**
   * Socket is open and hello succeeded. Prefer this over waiting on
   * `host/status` so a timed-out status cannot pin the shell offline.
   */
  private markRemoteAvailable(input?: {
    mode?: HostMode;
    mock?: boolean;
    capabilities?: RemoteCapabilitySummary;
  }): void {
    if (input?.mode !== undefined) {
      this.mode = input.mode;
    }
    if (input?.capabilities !== undefined) {
      this.remoteCapabilities = mergeRemoteCapabilities(this.remoteCapabilities, input.capabilities);
    }
    this.ready = true;
    this.emit({
      type: 'host/status',
      mode: this.mode,
      ready: true,
      mock: input?.mock === true,
    });
  }

  private async refreshRemoteStatus(): Promise<void> {
    const status = await this.request({ type: 'host/status' });
    if (!status.success) {
      // Keep the hello-derived ready bit. Status is enrichment, not admission.
      this.emit({
        type: 'host/log',
        level: 'warn',
        message: status.error,
      });
      return;
    }
    const data = status.data as {
      mode?: HostMode;
      mock?: boolean;
      ready?: boolean;
      capabilities?: RemoteCapabilitySummary;
    } | undefined;
    this.markRemoteAvailable({
      mode: data?.mode === 'rpc' ? 'rpc' : 'sdk',
      mock: data?.mock === true,
      ...(data?.capabilities === undefined ? {} : { capabilities: data.capabilities }),
    });
  }

  private markRemoteUnavailable(): void {
    if (!this.ready) {
      return;
    }
    this.ready = false;
    this.emit({
      type: 'host/status',
      mode: this.mode,
      ready: false,
      mock: this.hostMock,
    });
  }

  private rememberRemoteHello(hello: HostHello): void {
    this.remoteCapabilities = hello.capabilities;
  }

  private async requestFromRemoteHost(
    command: HostCommand,
    options: { idempotencyKey?: string } = {},
  ): Promise<HostResponse> {
    try {
      const remote = this.getOrCreateRemoteClient();
      const remoteState = remote.getState().kind;
      // Package HostClient stays `connecting` until replay/done; the wire is
      // already admitted after hello, so commands must not wait on catch-up.
      if (
        remoteState !== 'ready' &&
        remoteState !== 'connecting' &&
        remoteState !== 'resync-required'
      ) {
        return {
          type: 'response',
          command: command.type,
          success: false,
          error: 'Host transport is not open',
          ...(command.id ? { id: command.id } : {}),
        };
      }
      const timeoutMs = getHostRequestTimeoutMs(command, 'remote');
      return await remote.request(command, {
        timeoutMs: timeoutMs > 0 ? timeoutMs : 3_600_000,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      });
    } catch (error) {
      return {
        type: 'response',
        command: command.type,
        success: false,
        error: formatError(error),
        ...(command.id ? { id: command.id } : {}),
      };
    }
  }

  private getOrCreateRemoteClient(): ReturnType<typeof createDesktopRemoteHostClient> {
    if (this.remoteClient) {
      return this.remoteClient;
    }
    if (this.remoteTarget === undefined) {
      throw new Error('Remote Host target is not configured');
    }

    const remote = createDesktopRemoteHostClient(this.remoteTarget, { autoReconnect: true });
    // Package HostClient already fans each batch item to push listeners. Do not
    // also subscribeBatch → emitBatch or the Desktop UI sees every item twice.
    const unsubscribePush = remote.subscribePush((push) => {
      if (push.type === 'host/status') {
        this.mode = push.mode;
        // Wire admission is hello. A journal/replay `host/status` with
        // ready:false (Host boot, lease, shutdown) must not paint the shell
        // "connecting" on a socket that is already carrying commands.
      }
      this.emit(push);
    });
    const unsubscribeHydration = remote.subscribeHydration((frame) => {
      this.emit(frame);
    });
    const unsubscribeSnapshot = remote.subscribeSnapshot((frame) => {
      // Desktop keeps hydration:false. Forward the snapshot so bootstrap can
      // force session/transcript catch-up (not just host/status enrichment).
      this.markRemoteAvailable({
        mode: frame.status.mode,
        mock: frame.status.mock,
        capabilities: frame.status.capabilities,
      });
      this.emit(frame);
      void this.restoreRemoteReady();
    });
    const unsubscribeState = remote.subscribeState((state) => {
      if (state.kind === 'disconnected' || state.kind === 'error') {
        this.markRemoteUnavailable();
        return;
      }
      // Package state stays `connecting` through journal catch-up. Hello means
      // the wire is admitted — unblock the shell; do not wait for replay/done.
      if (
        this.remoteInitialConnectDone &&
        remote.getHostHello() !== undefined &&
        (state.kind === 'connecting' ||
          state.kind === 'ready' ||
          state.kind === 'resync-required')
      ) {
        this.markRemoteAvailable();
        if (state.kind === 'ready') {
          void this.restoreRemoteReady();
        }
      }
    });
    this.unsubscribeLiveRemote = registerLiveDesktopRemoteHost({
      target: this.remoteTarget,
      isReady: () => this.ready && remote.getState().kind === 'ready',
      requestStatus: async () => {
        const status = await this.request({ type: 'host/status' });
        if (!status.success) {
          return { ok: false, error: status.error };
        }
        const hostInstanceId = readRemoteHostInstanceId(status.data);
        return hostInstanceId === undefined ? { ok: true } : { ok: true, hostInstanceId };
      },
    });
    this.unsubscribeRemote = () => {
      unsubscribePush();
      unsubscribeHydration();
      unsubscribeSnapshot();
      unsubscribeState();
    };
    this.remoteClient = remote;
    return remote;
  }

  private async requestFromLiveHost(
    command: HostCommand | LocalMobileAccessCommand,
    options: { idempotencyKey?: string } = {},
  ): Promise<HostResponse> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const envelope = {
        v: HOST_COMMAND_REQUEST_ENVELOPE_VERSION,
        command,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        clientPrincipalId: readDesktopClientPrincipalId(),
      };
      const response = (await invoke('host_request', {
        command: envelope,
        timeoutMs: getHostRequestTimeoutMs(command),
      })) as HostResponse;
      return response;
    } catch (error) {
      return {
        type: 'response',
        command: command.type,
        success: false,
        error: formatError(error),
        ...(command.id ? { id: command.id } : {}),
      };
    }
  }

  private async getMockBackend(): Promise<MockHostBackend> {
    if (this.mockBackend) {
      return this.mockBackend;
    }
    if (this.pendingMockBackend) {
      return this.pendingMockBackend;
    }

    // The deterministic browser backend is large and is never used by the
    // production Tauri path. Keep it behind the mock transport boundary.
    const pending = import('./host-client-mock').then(({ MockHostBackend }) => {
      const backend = new MockHostBackend(
        (message) => this.emit(message),
        () => this.mode,
      );
      this.mockBackend = backend;
      return backend;
    });
    this.pendingMockBackend = pending;
    try {
      return await pending;
    } finally {
      if (this.pendingMockBackend === pending) {
        this.pendingMockBackend = null;
      }
    }
  }

  private emit(message: HostPush | HostServerMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private emitBatch(batch: HostPushBatchFrame): void {
    if (!isHostPushBatchFrame(batch)) {
      console.warn('[host] ignoring malformed push batch');
      return;
    }

    const hostChanged = this.hostInstanceId !== batch.hostInstanceId;
    const previousSeq = hostChanged ? 0 : this.lastHostSeq;
    if (batch.throughSeq < previousSeq) {
      console.warn('[host] ignoring stale push batch', {
        hostInstanceId: batch.hostInstanceId,
        previousSeq,
        throughSeq: batch.throughSeq,
      });
      return;
    }

    if (!hostChanged && previousSeq > 0 && batch.afterSeq > previousSeq) {
      this.sequenceGapHandler?.({
        hostInstanceId: batch.hostInstanceId,
        missedFromSeq: previousSeq + 1,
        receivedFromSeq: batch.afterSeq + 1,
      });
    }

    // Advance the cursor only after every contained push has been offered to
    // subscribers. If a subscriber throws, this transaction remains unacked.
    for (const item of batch.items) {
      if (item.seq <= previousSeq) {
        continue;
      }
      if (item.push.type === 'host/status') {
        this.ready = item.push.ready;
        this.mode = item.push.mode;
      }
      this.emit(item.push);
    }
    this.hostInstanceId = batch.hostInstanceId;
    this.lastHostSeq = batch.throughSeq;
  }

  /**
   * `currentSeq` is the Host's cursor fence, not the last item this client's
   * subscription could see. Filtered replay tails skip records; live delivery
   * then resumes at afterSeq=currentSeq. Adopt the fence or emitBatch treats
   * the next valid batch as a hole and kicks reconcile/replay.
   */
  private adoptHostCursorFence(currentSeq: number): void {
    if (!isSafeSequence(currentSeq) || currentSeq <= this.lastHostSeq) {
      return;
    }
    this.lastHostSeq = currentSeq;
  }

  // --- Browser session commands (ADR 0020 §6) -------------------------------

  /** Start the shared browser session (idempotent). */
  async browserStart(leaseId?: string): Promise<HostResponse> {
    return this.request({
      type: 'browser/start',
      ...(leaseId !== undefined ? { leaseId } : {}),
    });
  }

  /** Navigate the mirrored browser to `url`. */
  async browserNavigate(url: string): Promise<HostResponse> {
    return this.request({ type: 'browser/navigate', url });
  }

  /** Pick the web element at viewport CSS coordinates (x, y). */
  async browserPickAt(x: number, y: number): Promise<HostResponse> {
    return this.request({ type: 'browser/pick-at', x, y });
  }

  /** Capture a screenshot; when `path` is omitted the host chooses the path. */
  async browserScreenshot(path?: string): Promise<HostResponse> {
    return this.request({
      type: 'browser/screenshot',
      ...(path !== undefined ? { path } : {}),
    });
  }

  /** Release the Desktop mirror lease and its current Chromium runtime. */
  async browserStop(leaseId?: string): Promise<HostResponse> {
    return this.request({
      type: 'browser/stop',
      ...(leaseId !== undefined ? { leaseId } : {}),
    });
  }

  async browserInput(events: BrowserInputEvent[]): Promise<HostResponse> {
    return this.request({ type: 'browser/input', events });
  }

  async browserLock(owner: 'agent' | 'user'): Promise<HostResponse> {
    return this.request({ type: 'browser/lock', owner });
  }

  async browserUnlock(owner: 'agent' | 'user'): Promise<HostResponse> {
    return this.request({ type: 'browser/unlock', owner });
  }

  async browserResize(width: number, height: number): Promise<HostResponse> {
    return this.request({ type: 'browser/resize', width, height });
  }

  // --- Side Chat commands (spec §8) -----------------------------------------

  /** Open a side chat from a main session. */
  async sideChatOpen(
    sourceSessionId: string,
    options?: {
      name?: string;
      sourceMessageId?: string;
      refs?: import('@piwin/contracts').SideChatContextRef[];
    },
  ): Promise<HostResponse> {
    return this.request({
      type: 'side-chat/open',
      sourceSessionId,
      ...(options?.name ? { name: options.name } : {}),
      ...(options?.sourceMessageId ? { sourceMessageId: options.sourceMessageId } : {}),
      ...(options?.refs && options.refs.length > 0 ? { refs: options.refs } : {}),
    });
  }

  /** List side chats for a source session. */
  async sideChatList(
    sourceSessionId: string,
    options?: { includeArchived?: boolean },
  ): Promise<HostResponse> {
    return this.request({
      type: 'side-chat/list',
      sourceSessionId,
      ...(options?.includeArchived ? { includeArchived: true } : {}),
    });
  }

  /** Sync a side chat's context from its source session. */
  async sideChatSync(sideChatSessionId: string): Promise<HostResponse> {
    return this.request({ type: 'side-chat/sync', sideChatSessionId });
  }
}

export function mergeRemoteCapabilities(
  current: RemoteCapabilitySummary | undefined,
  next: RemoteCapabilitySummary,
): RemoteCapabilitySummary {
  void current;
  // Omitted `allowedCommands` means operator: every command. Never keep a
  // previous Host's ceiling across hello/status — that made settings look
  // like "no permission" after reconnecting to a newer Host.
  return next;
}
