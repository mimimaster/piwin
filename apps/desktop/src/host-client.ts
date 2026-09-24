import type {
  BrowserInputEvent,
  BrowserTargetIdentity,
  HostCommand,
  HostResponse,
  LocalMobileAccessCommand,
} from '@piwin/contracts';
import {
  isLocalMobileAccessCommandType,
  remoteCommandRequiresIdempotencyKey,
} from '@piwin/contracts';
import { MOBILE_ACCESS_SIDECAR_ONLY_ERROR } from './mobile-access-local';
import type { MockHostBackend } from './host-client-mock';
import type { DesktopRemoteHostTarget } from './remote-host-session';
import type { HostClientOptions, TransportMode } from './host-client-transport-detect.js';
import { HostClientRemoteTransport } from './host-client-remote-transport.js';
import {
  requestBrowserCapture,
  requestBrowserInput,
  requestBrowserNavigate,
  requestBrowserPickAt,
  requestBrowserReload,
  requestBrowserResize,
  requestBrowserRestart,
  requestBrowserScreenshot,
  requestBrowserStart,
  requestBrowserStop,
  type BrowserCaptureOptions,
  type BrowserResizeOptions,
} from './host-client-browser';
import {
  requestSideChatList,
  requestSideChatOpen,
  requestSideChatSync,
} from './host-client-side-chat.js';

export type { HostClientListener } from './host-client-state.js';
export type {
  HostPushSequenceGap,
  HostSequenceGapHandler,
} from './host-client-push.js';
export type { HostClientOptions } from './host-client-transport-detect.js';
export { mergeRemoteCapabilities } from './host-client-remote-transport.js';

/**
 * Frontend host client. Never imports Pi.
 * - mock: {@link MockHostBackend}
 * - live: Tauri commands → Node `host serve` JSONL sidecar
 * - remote: `@piwin/host-client` over WebSocket; never invokes the JSONL bridge
 *
 * Composition root of the split client: shared state in `host-client-state.ts`,
 * push fan-out in `host-client-push.ts`, the sidecar bridge in
 * `host-client-live-transport.ts`, the WebSocket bridge in
 * `host-client-remote-transport.ts`. Command domains are free functions over
 * `request` (`host-client-browser.ts`, `host-client-side-chat.ts`).
 */
export class HostClient extends HostClientRemoteTransport {
  private mockBackend: MockHostBackend | null = null;
  private pendingMockBackend: Promise<MockHostBackend> | null = null;

  constructor(options: HostClientOptions = {}) {
    super(options);
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

  getHostInstanceId(): string | null {
    return this.hostInstanceId;
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

    await this.startLiveTransport();
  }

  async dispose(): Promise<void> {
    this.stopLiveListeners();
    await this.disposeRemoteTransport();
    await this.stopLiveHostProcess();

    this.listeners.clear();
    this.mockBackend?.clear();
    this.ready = false;
    this.resetRemoteState();
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

  // --- Browser session commands (ADR 0020 §6) -------------------------------

  /** Start the shared browser session (idempotent). */
  async browserStart(leaseId?: string): Promise<HostResponse> {
    return requestBrowserStart(this, leaseId);
  }

  /** Navigate the mirrored browser to `url`. */
  async browserNavigate(url: string): Promise<HostResponse> {
    return requestBrowserNavigate(this, url);
  }

  /** Pick the web element at viewport CSS coordinates (x, y). */
  async browserPickAt(
    x: number,
    y: number,
    target?: BrowserTargetIdentity,
  ): Promise<HostResponse> {
    return requestBrowserPickAt(this, x, y, target);
  }

  /** Capture a screenshot; when `path` is omitted the host chooses the path. */
  async browserCapture(options?: BrowserCaptureOptions): Promise<HostResponse> {
    return requestBrowserCapture(this, options);
  }

  async browserScreenshot(path?: string): Promise<HostResponse> {
    return requestBrowserScreenshot(this, path);
  }

  /** Release the Desktop mirror lease and its current Chromium runtime. */
  async browserStop(leaseId?: string): Promise<HostResponse> {
    return requestBrowserStop(this, leaseId);
  }

  /** Rebuild the Host-owned runtime in place. Does not mint a new mirror lease. */
  async browserRestart(): Promise<HostResponse> {
    return requestBrowserRestart(this);
  }

  async browserReload(): Promise<HostResponse> {
    return requestBrowserReload(this);
  }

  async browserInput(
    events: BrowserInputEvent[],
    target?: BrowserTargetIdentity,
  ): Promise<HostResponse> {
    return requestBrowserInput(this, events, target);
  }

  async browserResize(
    width: number,
    height: number,
    options?: BrowserResizeOptions,
  ): Promise<HostResponse> {
    return requestBrowserResize(this, width, height, options);
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
    return requestSideChatOpen(this, sourceSessionId, options);
  }

  /** List side chats for a source session. */
  async sideChatList(
    sourceSessionId: string,
    options?: { includeArchived?: boolean },
  ): Promise<HostResponse> {
    return requestSideChatList(this, sourceSessionId, options);
  }

  /** Sync a side chat's context from its source session. */
  async sideChatSync(sideChatSessionId: string): Promise<HostResponse> {
    return requestSideChatSync(this, sideChatSessionId);
  }
}
