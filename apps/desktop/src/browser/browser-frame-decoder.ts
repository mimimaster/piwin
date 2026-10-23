/**
 * Validate, pair, and atomically replace browser-frame pictures (spec §4.1.2).
 *
 * The reducer never writes `<img src>` from a raw push string. A candidate
 * must decode, still match the live target, and carry a newer frameId before
 * it replaces the last good picture. Object URLs are revoked after swap or
 * dispose. Binary payloads that arrive more than 2s after their metadata are
 * dropped so a late JPEG cannot overwrite a newer live frame.
 */
import {
  BROWSER_FRAME_PAYLOAD_TIMEOUT_MS,
  MAX_BROWSER_FRAME_BINARY_BYTES,
  type BrowserFramePush,
} from '@piwin/contracts';
import { decodeBrowserFrameBinary } from '@piwin/host-transport';

export const BROWSER_JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,';

export type BrowserFrameErrorReason =
  | 'invalid-inline'
  | 'redacted'
  | 'payload-timeout'
  | 'decode-failed'
  | 'unavailable'
  | 'client-update-required'
  | 'frame-channel-unavailable';

export type BrowserFrameView = {
  src: string;
  viewportWidth: number;
  viewportHeight: number;
  encodedWidth: number;
  encodedHeight: number;
  sourceDpr: number;
  quality: number;
  producer: BrowserFramePush['producer'];
  frameId: string;
  generation: number;
  pageId: string;
  documentRevision: number;
  byteLength: number;
};

export type BrowserFrameDecoder = {
  ingestPush(push: BrowserFramePush): void;
  ingestBinary(bytes: Uint8Array): void;
  reset(): void;
  dispose(): void;
};

export type BrowserFrameDecoderOptions = {
  onReady: (view: BrowserFrameView) => void;
  onError: (reason: BrowserFrameErrorReason) => void;
  now?: () => number;
  timeoutMs?: number;
  decode?: (src: string) => Promise<void>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  schedule?: (callback: () => void, ms: number) => number;
  cancel?: (id: number) => void;
};

type PendingMeta = {
  push: BrowserFramePush;
  timer: number;
};

function isNewerFrame(next: BrowserFramePush, current: BrowserFrameView | undefined): boolean {
  if (current === undefined) return true;
  if (next.generation !== current.generation) return next.generation > current.generation;
  if (next.pageId !== current.pageId) return true;
  const nextId = Number(next.frameId);
  const currentId = Number(current.frameId);
  if (Number.isFinite(nextId) && Number.isFinite(currentId)) return nextId > currentId;
  return next.frameId !== current.frameId;
}

function viewFromPush(push: BrowserFramePush, src: string): BrowserFrameView {
  return {
    src,
    viewportWidth: push.width,
    viewportHeight: push.height,
    encodedWidth: push.encodedWidth,
    encodedHeight: push.encodedHeight,
    sourceDpr: push.sourceDpr,
    quality: push.quality,
    producer: push.producer,
    frameId: push.frameId,
    generation: push.generation,
    pageId: push.pageId,
    documentRevision: push.documentRevision,
    byteLength: push.byteLength,
  };
}

/** Inline JPEG only — a redacted or non-JPEG URL must never become an `<img src>`. */
export function validateInlineJpegDataUrl(dataUrl: string, maxBytes: number): boolean {
  const trimmed = dataUrl.trim();
  if (trimmed === '[redacted]') return false;
  if (!trimmed.startsWith(BROWSER_JPEG_DATA_URL_PREFIX)) return false;
  const base64 = trimmed.slice(BROWSER_JPEG_DATA_URL_PREFIX.length);
  if (base64.length === 0) return false;
  if (base64.length > Math.ceil((maxBytes / 3) * 4) + 4) return false;
  return true;
}

export function createBrowserFrameDecoder(options: BrowserFrameDecoderOptions): BrowserFrameDecoder {
  const timeoutMs = options.timeoutMs ?? BROWSER_FRAME_PAYLOAD_TIMEOUT_MS;
  const decode = options.decode ?? (async () => undefined);
  const createObjectUrl =
    options.createObjectUrl ??
    ((blob: Blob) => {
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        throw new Error('object URL factory is required');
      }
      return URL.createObjectURL(blob);
    });
  const revokeObjectUrl =
    options.revokeObjectUrl ??
    ((url: string) => {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
    });
  const schedule = options.schedule ?? ((callback, ms) => window.setTimeout(callback, ms));
  const cancel = options.cancel ?? ((id) => window.clearTimeout(id));

  let disposed = false;
  let generation = 0;
  let current: BrowserFrameView | undefined;
  let pending: PendingMeta | undefined;
  let unmatchedBinary: { frameId: string; jpeg: Uint8Array } | undefined;
  let timedOutFrameId: string | undefined;
  let candidateSrc: string | undefined;

  function revokeIfObject(url: string | undefined): void {
    if (url !== undefined && url.startsWith('blob:')) revokeObjectUrl(url);
  }

  function clearPending(): void {
    if (pending !== undefined) {
      cancel(pending.timer);
      pending = undefined;
    }
  }

  function fail(reason: BrowserFrameErrorReason): void {
    options.onError(reason);
  }

  async function accept(push: BrowserFramePush, src: string, acceptGeneration: number): Promise<void> {
    try {
      await decode(src);
    } catch {
      revokeIfObject(src);
      if (candidateSrc === src) candidateSrc = undefined;
      if (!disposed && acceptGeneration === generation) fail('decode-failed');
      return;
    }
    if (disposed || acceptGeneration !== generation) {
      revokeIfObject(src);
      return;
    }
    if (candidateSrc === src) candidateSrc = undefined;
    if (!isNewerFrame(push, current)) {
      revokeIfObject(src);
      return;
    }
    const previous = current?.src;
    current = viewFromPush(push, src);
    options.onReady(current);
    if (previous !== undefined && previous !== src) revokeIfObject(previous);
  }

  function ingestInline(push: BrowserFramePush): void {
    const dataUrl = push.payload.kind === 'inline' ? push.payload.dataUrl : '';
    if (dataUrl.trim() === '[redacted]') {
      fail('redacted');
      return;
    }
    if (!validateInlineJpegDataUrl(dataUrl, MAX_BROWSER_FRAME_BINARY_BYTES)) {
      fail('invalid-inline');
      return;
    }
    void accept(push, dataUrl, generation);
  }

  function ingestJpeg(push: BrowserFramePush, jpeg: Uint8Array): void {
    let src: string;
    try {
      src = createObjectUrl(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
    } catch {
      fail('decode-failed');
      return;
    }
    candidateSrc = src;
    void accept(push, src, generation);
  }

  return {
    ingestPush(push) {
      if (disposed) return;
      if (!isNewerFrame(push, current) && push.payload.kind !== 'unavailable') return;
      if (push.payload.kind === 'unavailable') {
        fail(push.payload.reason);
        return;
      }
      if (push.payload.kind === 'inline') {
        clearPending();
        ingestInline(push);
        return;
      }
      if (unmatchedBinary !== undefined && unmatchedBinary.frameId === push.frameId) {
        const jpeg = unmatchedBinary.jpeg;
        unmatchedBinary = undefined;
        clearPending();
        ingestJpeg(push, jpeg);
        return;
      }
      unmatchedBinary = undefined;
      timedOutFrameId = undefined;
      clearPending();
      pending = {
        push,
        timer: schedule(() => {
          const frameId = pending?.push.frameId;
          pending = undefined;
          timedOutFrameId = frameId;
          fail('payload-timeout');
        }, timeoutMs),
      };
    },
    ingestBinary(bytes) {
      if (disposed) return;
      const decoded = decodeBrowserFrameBinary(bytes);
      if (!decoded.ok) {
        fail('decode-failed');
        return;
      }
      const { header, jpeg } = decoded;
      if (timedOutFrameId === header.frameId) return;
      if (pending !== undefined && pending.push.frameId === header.frameId) {
        const push = pending.push;
        clearPending();
        ingestJpeg(push, jpeg);
        return;
      }
      // One unmatched payload only — a newer JPEG replaces an unused one.
      unmatchedBinary = { frameId: header.frameId, jpeg };
    },
    reset() {
      generation += 1;
      clearPending();
      unmatchedBinary = undefined;
      timedOutFrameId = undefined;
      revokeIfObject(candidateSrc);
      candidateSrc = undefined;
      revokeIfObject(current?.src);
      current = undefined;
    },
    dispose() {
      disposed = true;
      this.reset();
    },
  };
}
