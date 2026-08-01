import type {
  HostCommand,
  HostMode,
  HostPush,
  HostResponse,
  HostServerMessage,
} from '@piwin/contracts';
import { MockHostBackend } from './host-client-mock';

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
const HOST_REQUEST_NETWORK_QUERY_TIMEOUT_MS = 30_000;

function getHostRequestTimeoutMs(command: HostCommand): number {
  switch (command.type) {
    case 'session/prompt':
    case 'session/abort':
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
    case 'mcp/start':
    case 'mcp/stop':
    case 'skills/install':
    case 'extensions/install':
    case 'theme/install-local':
    case 'pet/install-local':
    case 'pet/install-registry':
      return HOST_REQUEST_OPERATION_TIMEOUT_MS;
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
  private unlistenHostLog: (() => void) | null = null;
  private unlistenHostStatus: (() => void) | null = null;
  /** Prevent Strict Mode/HMR from registering the Tauri event bridge twice. */
  private pendingConnection: Promise<void> | null = null;
  private readonly mockBackend: MockHostBackend | null;

  constructor(options: HostClientOptions = {}) {
    this.transport = detectTransport(options);
    this.hostMock = options.hostMock !== false;
    this.mockBackend =
      this.transport === 'mock'
        ? new MockHostBackend(
            (message) => this.emit(message),
            () => this.mode,
          )
        : null;
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
      return this.mockBackend!.handle(withId, id);
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
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'response',
        command: command.type,
        success: false,
        error: message,
        ...(command.id ? { id: command.id } : {}),
      };
    }
  }

  private emit(message: HostPush | HostServerMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  // --- Browser session commands (ADR 0020 §6) -------------------------------

  /** Start the shared browser session (idempotent). */
  async browserStart(): Promise<HostResponse> {
    return this.request({ type: 'browser/start' });
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

  /** Stop the shared browser session and release Chromium. */
  async browserStop(): Promise<HostResponse> {
    return this.request({ type: 'browser/stop' });
  }
}
