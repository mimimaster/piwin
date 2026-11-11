import {
  BROWSER_FRAME_NATIVE_STREAM_VERSION,
  type BrowserFrameNativeDeliveryStatus,
  type BrowserFrameNativeResourceReady,
  type BrowserFrameNativeStreamOpenResult,
} from '@piwin/contracts';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

const READY_EVENT = 'browser-frame-resource-ready';
const FETCH_TIMEOUT_MS = 5_000;

export type BrowserFrameNativeStream = {
  close: () => Promise<void>;
};

export async function openBrowserFrameNativeStream(input: {
  sessionId?: string;
  onFrame: (bytes: Uint8Array) => void;
  onError: () => void;
  signal: AbortSignal;
}): Promise<BrowserFrameNativeStream> {
  if (!isTauri()) throw new Error('native browser frame transport requires the Desktop shell');

  let stream: BrowserFrameNativeStreamOpenResult | undefined;
  let closed = false;
  let failed = false;
  let activeFetch = false;
  let pendingReady: BrowserFrameNativeResourceReady | undefined;
  let highestDeliveryId = 0;
  let fetchController: AbortController | undefined;
  let unlisten: UnlistenFn | undefined;

  const closeNativeStream = async (): Promise<void> => {
    const current = stream;
    if (current === undefined) return;
    await invoke('browser_frame_stream_close', { streamId: current.streamId });
  };

  const drainReady = (): void => {
    const next = pendingReady;
    if (next === undefined || activeFetch || closed || failed) return;
    pendingReady = undefined;
    void fetchDelivery(next);
  };

  const acknowledge = async (
    ready: BrowserFrameNativeResourceReady,
    status: BrowserFrameNativeDeliveryStatus,
  ): Promise<void> => {
    await invoke('browser_frame_delivery_ack', {
      streamId: ready.streamId,
      deliveryId: ready.deliveryId,
      status,
    });
  };

  const fetchDelivery = async (ready: BrowserFrameNativeResourceReady): Promise<void> => {
    const current = stream;
    if (current === undefined || ready.streamId !== current.streamId || closed || failed) return;
    activeFetch = true;
    const controller = new AbortController();
    fetchController = controller;
    const timeout = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${current.resourceUrlBase}/${String(ready.deliveryId)}`, {
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`native frame request returned ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > current.maxPacketBytes) throw new Error('native frame exceeded its byte limit');
      await acknowledge(ready, 'received');
      if (!closed) input.onFrame(bytes);
    } catch {
      if (!closed) {
        failed = true;
        pendingReady = undefined;
        try {
          await acknowledge(ready, 'failed');
        } catch (error: unknown) {
          console.warn('[browser] failed to pause native frame delivery', error);
        }
        input.onError();
      }
    } finally {
      globalThis.clearTimeout(timeout);
      if (fetchController === controller) fetchController = undefined;
      activeFetch = false;
      drainReady();
    }
  };

  const onReady = (notification: BrowserFrameNativeResourceReady): void => {
    if (closed || failed || stream === undefined || notification.streamId !== stream.streamId) return;
    if (notification.deliveryId <= highestDeliveryId) return;
    highestDeliveryId = notification.deliveryId;
    if (activeFetch) {
      pendingReady = notification;
      return;
    }
    pendingReady = notification;
    drainReady();
  };

  const abort = (): void => {
    closed = true;
    pendingReady = undefined;
    fetchController?.abort();
    unlisten?.();
    void closeNativeStream().catch((error: unknown) => {
      console.warn('[browser] failed to close native frame stream', error);
    });
  };

  if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  unlisten = await listen<BrowserFrameNativeResourceReady>(READY_EVENT, (event) => onReady(event.payload));
  input.signal.addEventListener('abort', abort, { once: true });

  try {
    stream = await invoke<BrowserFrameNativeStreamOpenResult>('browser_frame_stream_open', {
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    });
    if (stream.version !== BROWSER_FRAME_NATIVE_STREAM_VERSION) {
      throw new Error(`unsupported native browser frame stream version: ${String(stream.version)}`);
    }
    if (input.signal.aborted) {
      closed = true;
      unlisten();
      await closeNativeStream();
      throw new DOMException('Aborted', 'AbortError');
    }
  } catch (error) {
    unlisten();
    input.signal.removeEventListener('abort', abort);
    await closeNativeStream().catch((closeError: unknown) => {
      console.warn('[browser] failed to release rejected native frame stream', closeError);
    });
    throw error;
  }

  return {
    async close() {
      if (closed) return;
      closed = true;
      pendingReady = undefined;
      input.signal.removeEventListener('abort', abort);
      fetchController?.abort();
      unlisten?.();
      await closeNativeStream();
    },
  };
}
