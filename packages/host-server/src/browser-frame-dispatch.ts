import type { BrowserFrameBinaryHeader } from '@piwin/contracts';
import { encodeBrowserFrameBinary } from '@piwin/host-transport';
import { OPEN_READY_STATE } from './host-client-connection.js';
import { HOST_SOCKET_SEND_BUDGET_BYTES } from './host-connection-lifecycle.js';
import { toError } from './host-server-support.js';

/** The binary-frame slice of a client connection. */
export type BrowserFrameConnection = {
  /** Client declared the out-of-band binary browser-frame channel. */
  browserFrameBinary: boolean;
  /** Lease ids from this client's successful `browser/start`s; empty when idle. */
  browserMirrorLeases: ReadonlySet<string>;
  /** Latest-only pending frame; a newer frame overwrites an unsent one. */
  pendingBrowserFrame: Uint8Array | undefined;
  browserFrameFlush: ReturnType<typeof setTimeout> | undefined;
  socket: {
    readonly readyState: number;
    readonly bufferedAmount: number;
    send(data: Uint8Array): void;
  };
};

export type BrowserFrameDispatchOptions = {
  connections: Iterable<BrowserFrameConnection>;
  header: BrowserFrameBinaryHeader;
  bytes: Uint8Array;
  /** Frame could not be encoded; carries the failure detail for diagnostics. */
  onDropped: (detail: string) => void;
  onSendError: (error: Error) => void;
};

/**
 * Raw JPEG delivery for the out-of-band channel (spec §4.1.2). Only clients
 * that declared the capability and hold a mirror lease receive frames, each
 * keeps at most one pending frame (newest wins), and a frame that cannot be
 * sent within the socket budget is dropped rather than queued. A frame that
 * cannot be framed at all is dropped without touching the control connection.
 */
export function deliverBrowserFrame(options: BrowserFrameDispatchOptions): void {
  let envelope: Uint8Array;
  try {
    envelope = encodeBrowserFrameBinary(options.header, options.bytes);
  } catch (error) {
    options.onDropped(error instanceof Error ? error.message : 'unknown');
    return;
  }
  for (const connection of options.connections) {
    if (!connection.browserFrameBinary) continue;
    if (connection.browserMirrorLeases.size === 0) continue;
    if (connection.socket.readyState !== OPEN_READY_STATE) continue;
    // A newer frame replaces the unsent one; the client waits for the next
    // live frame after a reconnect instead of replaying stale pixels.
    connection.pendingBrowserFrame = envelope;
    if (connection.browserFrameFlush !== undefined) continue;
    connection.browserFrameFlush = setTimeout(() => {
      connection.browserFrameFlush = undefined;
      const pending = connection.pendingBrowserFrame;
      connection.pendingBrowserFrame = undefined;
      if (pending === undefined) return;
      if (connection.socket.readyState !== OPEN_READY_STATE) return;
      if (connection.socket.bufferedAmount >= HOST_SOCKET_SEND_BUDGET_BYTES) return;
      try {
        connection.socket.send(pending);
      } catch (error) {
        options.onSendError(toError(error, 'Unable to send browser frame'));
      }
    }, 0);
    connection.browserFrameFlush.unref?.();
  }
}

/** Drops an unsent frame and cancels its scheduled flush. */
export function clearPendingBrowserFrame(connection: BrowserFrameConnection): void {
  if (connection.browserFrameFlush !== undefined) {
    clearTimeout(connection.browserFrameFlush);
    connection.browserFrameFlush = undefined;
  }
  connection.pendingBrowserFrame = undefined;
}
