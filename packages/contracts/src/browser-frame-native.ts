/** Local Desktop pull transport for bounded browser-frame delivery. */
export const BROWSER_FRAME_NATIVE_STREAM_VERSION = 1 as const;

/** The UI opens a stream before asking the Host to start its picture lease. */
export type BrowserFrameNativeStreamOpenResult = {
  version: typeof BROWSER_FRAME_NATIVE_STREAM_VERSION;
  streamId: string;
  resourceUrlBase: string;
  maxPacketBytes: number;
};

/** A small event; image bytes are fetched from the native resource route. */
export type BrowserFrameNativeResourceReady = {
  streamId: string;
  deliveryId: number;
};

/** `failed` pauses the stream; reopening it is an explicit new lease. */
export type BrowserFrameNativeDeliveryStatus = 'received' | 'failed';
