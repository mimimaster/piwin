import type {
  HostCommand,
  HostMode,
  HostPush,
  HostPushBatchFrame,
  HostResponse,
  HostServerMessage,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { MockHostBackend } from './host-client-mock';

export type HostClientListener = (message: HostServerMessage) => void;

export type HostClientOptions = {
  /**
   * true  → in-browser mock (Vite only)
   * false → Tauri sidecar `piwin host serve` JSONL bridge
   * 'auto'→ mock outside Tauri, live inside Tauri
   */
  transport?: boolean | 'auto' | 'mock' | 'live';
  /** When using live transport, start host with --mock (agent mock, not UI mock). Default true for scaffold. */
  hostMock?: boolean;
};

type TransportMode = 'mock' | 'live';

const HOST_REQUEST_ACK_TIMEOUT_MS = 5_000;
const HOST_REQUEST_STATUS_TIMEOUT_MS = 3_000;
const HOST_REQUEST_QUERY_TIMEOUT_MS = 15_000;
const HOST_REQUEST_OPERATION_TIMEOUT_MS = 120_000;
const HOST_REQUEST_IMAGE_GENERATION_TIMEOUT_MS = 360_000;
const HOST_REQUEST_NETWORK_QUERY_TIMEOUT_MS = 30_000;

function getHostRequestTimeoutMs(command: HostCommand): number {
  switch (command.type) {
    case 'session/prompt':
    case 'session/compact':
    case 'session/compact-export':
    case 'session/abort':
    case 'session/pause':
    case 'session/resume-run':
    case 'session/compact-abort':
    case 'session/steer':
    case 'session/follow_up':
    case 'permission/resolve':
    case 'extension/ui_resolve':
    case 'project/authorize-terminal':
      return HOST_REQUEST_ACK_TIMEOUT_MS;
    case 'host/ping':
    case 'host/status':
      return HOST_REQUEST_STATUS_TIMEOUT_MS;
    case 'models/discover':
    case 'models/test':
    case 'speech/transcribe':
    case 'mcp/start':
    case 'mcp/stop':
    case 'skills/install':
    case 'extensions/install':
    case 'plugins/install':
    case 'plugins/uninstall':
    case 'plugins/registry/list':
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
  return isTauriRuntime() ? 'live' : 'mock';
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Frontend host client. Never imports Pi.
 * - mock: {@link MockHostBackend}
 * - live: Tauri commands → Node `host serve` JSONL sidecar
 */
export class HostClient {
  private readonly listeners = new Set<HostClientListener>();
  private readonly transport: TransportMode;
  private readonly hostMock: boolean;
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

  constructor(options: HostClientOptions = {}) {
    this.transport = detectTransport(options);
    this.hostMock = options.hostMock !== false;
  }

  getTransport(): TransportMode {
    return this.transport;
  }

  isReady(): boolean {
    return this.ready;
  }

  subscribe(listener: HostClientListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    // Idempotent: HMR / Strict Mode remounts re-enter bootstrap without dispose.
    if (this.ready && this.transport === 'live' && this.unlistenHostMessage) {
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
  }

  async request(command: HostCommand): Promise<HostResponse> {
    const id = command.id ?? `ui-${++this.requestCounter}`;
    const withId = { ...command, id } as HostCommand;

    if (this.transport === 'mock') {
      const mockBackend = await this.getMockBackend();
      return mockBackend.handle(withId, id);
    }

    // Return host errors unchanged. Retrying after a string-matched error can
    // repeat state mutations or control commands against a restarted sidecar.
    return this.requestFromLiveHost(withId);
  }

  private async requestFromLiveHost(command: HostCommand): Promise<HostResponse> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const response = (await invoke('host_request', {
        command,
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

function isHostPushBatchFrame(value: unknown): value is HostPushBatchFrame {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type !== 'push/batch' ||
    typeof record.hostInstanceId !== 'string' ||
    record.hostInstanceId.length === 0 ||
    !isSafeSequence(record.afterSeq) ||
    !isSafeSequence(record.throughSeq) ||
    record.throughSeq < record.afterSeq ||
    !Array.isArray(record.items)
  ) {
    return false;
  }
  let previousSeq = record.afterSeq;
  for (const item of record.items) {
    if (typeof item !== 'object' || item === null) {
      return false;
    }
    const itemRecord = item as Record<string, unknown>;
    const pushRecord =
      typeof itemRecord.push === 'object' && itemRecord.push !== null
        ? (itemRecord.push as Record<string, unknown>)
        : undefined;
    if (
      !isSafeSequence(itemRecord.seq) ||
      itemRecord.seq <= previousSeq ||
      itemRecord.seq > record.throughSeq ||
      typeof itemRecord.eventId !== 'string' ||
      itemRecord.eventId.length === 0 ||
      pushRecord === undefined ||
      (pushRecord.seq !== undefined && pushRecord.seq !== itemRecord.seq) ||
      (pushRecord.eventId !== undefined && pushRecord.eventId !== itemRecord.eventId)
    ) {
      return false;
    }
    previousSeq = itemRecord.seq;
  }
  return true;
}

function isSafeSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
