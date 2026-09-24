import type {
  HostCommand,
  HostMode,
  HostPushBatchFrame,
  HostResponse,
  HostServerMessage,
  LocalMobileAccessCommand,
} from '@piwin/contracts';
import { HOST_COMMAND_REQUEST_ENVELOPE_VERSION, formatError } from '@piwin/contracts';
import { readDesktopClientPrincipalId } from './desktop-client-principal.js';
import { isReplayDoneFrame } from './host-push-frame.js';
import { getHostRequestTimeoutMs } from './host-client-request-timeouts.js';
import { HostClientPushLayer } from './host-client-push.js';
import { isTauriRuntime } from './host-client-transport-detect.js';

/**
 * Tauri sidecar transport: `piwin host serve` over the JSONL bridge, plus the
 * event listeners the Rust supervisor emits (host-message, push batches,
 * logs, status). Remote and mock never install these.
 */
export abstract class HostClientLiveTransport extends HostClientPushLayer {
  protected unlistenHostMessage: (() => void) | null = null;
  private unlistenHostMessageBatch: (() => void) | null = null;
  private unlistenHostLog: (() => void) | null = null;
  private unlistenHostStatus: (() => void) | null = null;

  /**
   * Request dispatch lives on the composition root; a layer that opens a
   * transport probes `host/status` through it once the transport is up.
   */
  protected abstract request(
    command: HostCommand | LocalMobileAccessCommand,
    options?: { idempotencyKey?: string },
  ): Promise<HostResponse>;

  /** Attach the Tauri event bridge and start the sidecar process. */
  protected async startLiveTransport(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');

    this.stopLiveListeners();

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

  /** Release the event listeners registered by {@link startLiveTransport}. */
  protected stopLiveListeners(): void {
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
  }

  /** Ask the supervising process to stop; listeners are already released. */
  protected async stopLiveHostProcess(): Promise<void> {
    if (this.transport === 'live' && isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('host_stop');
      } catch (error) {
        console.warn('host_stop failed', error);
      }
    }
  }

  protected async requestFromLiveHost(
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
}
