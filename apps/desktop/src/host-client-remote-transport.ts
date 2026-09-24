import type {
  HostCommand,
  HostHello,
  HostMode,
  HostResponse,
  RemoteCapabilitySummary,
} from '@piwin/contracts';
import { formatError, remoteHostSupportsCommand } from '@piwin/contracts';
import {
  createDesktopRemoteHostClient,
  readRemoteHostInstanceId,
  registerLiveDesktopRemoteHost,
} from './remote-host-session';
import { getHostRequestTimeoutMs } from './host-client-request-timeouts.js';
import { HostClientLiveTransport } from './host-client-live-transport.js';

/**
 * Remote Host transport: `@piwin/host-client` over WebSocket (ADR 0036),
 * including the negotiated command ceiling, hello-derived readiness and the
 * reconnect/restore handlers.
 */
export abstract class HostClientRemoteTransport extends HostClientLiveTransport {
  private readonly binaryListeners = new Set<(bytes: Uint8Array) => void>();
  private unsubscribeRemoteBinary: (() => void) | null = null;
  protected remoteClient: ReturnType<typeof createDesktopRemoteHostClient> | null = null;
  private unsubscribeRemote: (() => void) | null = null;
  private unsubscribeLiveRemote: (() => void) | null = null;
  /** True after the first remote connect attempt; later `ready` is a reconnect. */
  private remoteInitialConnectDone = false;
  private remoteRestoreInFlight = false;
  private remoteCapabilities: RemoteCapabilitySummary | undefined;

  getRemoteCapabilities(): RemoteCapabilitySummary | undefined {
    return this.remoteCapabilities;
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

  /**
   * Remote JPEG frames. Local sidecar uses inline JSONL payloads instead.
   */
  subscribeBinary(listener: (bytes: Uint8Array) => void): () => void {
    this.binaryListeners.add(listener);
    if (this.remoteClient !== null && this.unsubscribeRemoteBinary === null) {
      this.attachRemoteBinary(this.remoteClient);
    }
    return () => {
      this.binaryListeners.delete(listener);
    };
  }

  private attachRemoteBinary(remote: ReturnType<typeof createDesktopRemoteHostClient>): void {
    this.unsubscribeRemoteBinary?.();
    this.unsubscribeRemoteBinary = remote.subscribeBinary((bytes) => {
      for (const listener of this.binaryListeners) listener(bytes);
    });
  }

  protected async connectRemoteTransport(): Promise<void> {
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

  protected async requestFromRemoteHost(
    command: HostCommand,
    options: { idempotencyKey?: string } = {},
  ): Promise<HostResponse> {
    try {
      const remote = this.getOrCreateRemoteClient();
      let remoteState = remote.getState().kind;
      const isRemoteDialing = remoteState === 'idle' || remoteState === 'connecting';
      if (remote.getHostHello() === undefined && isRemoteDialing && this.pendingConnection) {
        await this.pendingConnection;
        remoteState = remote.getState().kind;
      }
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
      this.unsubscribeRemoteBinary?.();
      this.unsubscribeRemoteBinary = null;
    };
    this.remoteClient = remote;
    this.attachRemoteBinary(remote);
    return remote;
  }

  /** Release remote subscriptions and close the socket. */
  protected async disposeRemoteTransport(): Promise<void> {
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
  }

  /** Drop hello/status derived state so a later connect starts clean. */
  protected resetRemoteState(): void {
    this.remoteInitialConnectDone = false;
    this.remoteRestoreInFlight = false;
    this.remoteCapabilities = undefined;
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
