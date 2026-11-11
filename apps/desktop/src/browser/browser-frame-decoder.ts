/** Bounded browser-frame pairing, single-flight decoding, and Blob ownership. */
import {
  BROWSER_FRAME_PAYLOAD_TIMEOUT_MS,
  MAX_BROWSER_FRAME_BINARY_BYTES,
  type BrowserFrameBinaryHeader,
  type BrowserFramePush,
} from '@piwin/contracts';
import { decodeBrowserFrameBinary } from '@piwin/host-transport';
import {
  browserFrameIdentitiesMatch,
  browserFrameIdentity,
  browserFrameIdentityKey,
  browserFrameIdentityOrder,
  type BrowserFrameIdentity,
} from './browser-frame-identity.js';
import { decodeInlineJpeg, validateInlineJpegDataUrl } from './browser-frame-inline.js';

export { BROWSER_JPEG_DATA_URL_PREFIX, validateInlineJpegDataUrl } from './browser-frame-inline.js';

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
  ingestNativePacket(bytes: Uint8Array): void;
  reset(): void;
  dispose(): void;
  setTarget(identity: BrowserFrameTargetIdentity): void;
  reportError(reason: BrowserFrameErrorReason): void;
  getCurrentBlob(): Blob | undefined;
};

export type BrowserFrameTargetIdentity = {
  generation?: number;
  pageId?: string;
  documentRevision?: number;
};

export type BrowserFrameDecoderOptions = {
  sessionId?: string;
  onReady: (view: BrowserFrameView) => void;
  onError: (reason: BrowserFrameErrorReason) => void;
  timeoutMs?: number;
  decode?: (src: string, signal: AbortSignal) => Promise<void>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  schedule?: (callback: () => void, ms: number) => number;
  cancel?: (id: number) => void;
};

type PendingMeta = { push: BrowserFramePush; timer: number };
type EncodedFrame = { push: BrowserFramePush; jpeg: Uint8Array; epoch: number };
type OwnedFrame = { view: BrowserFrameView; blob: Blob; identity: BrowserFrameIdentity };
type DecodeCandidate = {
  push: BrowserFramePush;
  blob: Blob | undefined;
  src: string;
  epoch: number;
  abort: AbortController;
  released: boolean;
};

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

export function createBrowserFrameDecoder(options: BrowserFrameDecoderOptions): BrowserFrameDecoder {
  const timeoutMs = options.timeoutMs ?? BROWSER_FRAME_PAYLOAD_TIMEOUT_MS;
  const decode = options.decode ?? (async () => undefined);
  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const schedule = options.schedule ?? ((callback, ms) => window.setTimeout(callback, ms));
  const cancel = options.cancel ?? ((id) => window.clearTimeout(id));

  let disposed = false;
  let epoch = 0;
  let target: BrowserFrameTargetIdentity = {};
  let current: OwnedFrame | undefined;
  let active: DecodeCandidate | undefined;
  let pendingFrame: EncodedFrame | undefined;
  let pendingMeta: PendingMeta | undefined;
  let unmatchedBinary: { header: BrowserFrameBinaryHeader; jpeg: Uint8Array } | undefined;
  let timedOutIdentity: string | undefined;
  let highWaterIdentity: BrowserFrameIdentity | undefined;

  function releaseUrl(url: string | undefined): void {
    if (url?.startsWith('blob:')) revokeObjectUrl(url);
  }

  function releaseCandidate(candidate: DecodeCandidate): void {
    if (candidate.released) return;
    candidate.released = true;
    candidate.blob = undefined;
    candidate.abort.abort();
    releaseUrl(candidate.src);
  }

  function clearPendingMeta(): void {
    if (pendingMeta === undefined) return;
    cancel(pendingMeta.timer);
    pendingMeta = undefined;
  }

  function clearFrames(): void {
    pendingFrame = undefined;
    unmatchedBinary = undefined;
    timedOutIdentity = undefined;
    highWaterIdentity = undefined;
    clearPendingMeta();
    if (active !== undefined) releaseCandidate(active);
    if (current !== undefined) releaseUrl(current.view.src);
    current = undefined;
  }

  function matchesTarget(push: Pick<BrowserFramePush, 'generation' | 'pageId' | 'documentRevision'>): boolean {
    return (target.generation === undefined || push.generation === target.generation) &&
      (target.pageId === undefined || push.pageId === target.pageId) &&
      (target.documentRevision === undefined || push.documentRevision === target.documentRevision);
  }

  function fail(reason: BrowserFrameErrorReason): void {
    if (!disposed) options.onError(reason);
  }

  function pump(): void {
    if (disposed || active !== undefined || pendingFrame === undefined) return;
    const frame = pendingFrame;
    pendingFrame = undefined;
    if (!matchesTarget(frame.push)) {
      pump();
      return;
    }

    let blob: Blob;
    let src: string;
    try {
      blob = new Blob([frame.jpeg as BlobPart], { type: 'image/jpeg' });
      src = createObjectUrl(blob);
    } catch {
      fail('decode-failed');
      pump();
      return;
    }

    const candidate: DecodeCandidate = {
      push: frame.push,
      blob,
      src,
      epoch: frame.epoch,
      abort: new AbortController(),
      released: false,
    };
    active = candidate;

    const settle = (decoded: boolean): void => {
      if (active === candidate) active = undefined;
      const canCommit = decoded && !disposed && candidate.epoch === epoch &&
        matchesTarget(candidate.push) && (current === undefined ||
          (browserFrameIdentityOrder(candidate.push, current.identity) ?? -1) > 0);
      const decodedBlob = candidate.blob;
      if (canCommit && !candidate.released && decodedBlob !== undefined) {
        const previous = current;
        const next = {
          view: viewFromPush(candidate.push, candidate.src), blob: decodedBlob,
          identity: browserFrameIdentity(candidate.push),
        };
        candidate.blob = undefined;
        current = next;
        options.onReady(next.view);
        if (previous !== undefined && previous.view.src !== next.view.src) {
          releaseUrl(previous.view.src);
        }
      } else {
        releaseCandidate(candidate);
        if (!decoded && !disposed && candidate.epoch === epoch && matchesTarget(candidate.push)) {
          fail('decode-failed');
        }
      }
      pump();
    };

    void decode(candidate.src, candidate.abort.signal).then(
      () => settle(true),
      () => settle(false),
    );
  }

  function queueFrame(push: BrowserFramePush, jpeg: Uint8Array, allowHighWaterMatch = false): void {
    if (!matchesTarget(push)) return;
    const order = highWaterIdentity === undefined
      ? 1
      : browserFrameIdentityOrder(push, highWaterIdentity);
    if (order === undefined || order < 0 || (order === 0 && !allowHighWaterMatch)) return;
    if (order > 0) highWaterIdentity = browserFrameIdentity(push);
    if (unmatchedBinary !== undefined) {
      const unmatchedOrder = browserFrameIdentityOrder(unmatchedBinary.header, push);
      if (unmatchedOrder !== undefined && unmatchedOrder <= 0) unmatchedBinary = undefined;
    }
    if (pendingFrame !== undefined) {
      const pendingOrder = browserFrameIdentityOrder(push, pendingFrame.push);
      if (pendingOrder === undefined || pendingOrder <= 0) return;
    }
    pendingFrame = { push: { ...push, payload: { kind: 'binary' } }, jpeg, epoch };
    pump();
  }

  return {
    ingestPush(push) {
      if (disposed || push.sessionId !== options.sessionId || !matchesTarget(push)) return;
      if (push.payload.kind === 'unavailable') {
        fail(push.payload.reason);
        return;
      }
      if (push.payload.kind === 'inline') {
        const order = highWaterIdentity === undefined
          ? 1
          : browserFrameIdentityOrder(push, highWaterIdentity);
        if (order === undefined || order <= 0) return;
        clearPendingMeta();
        unmatchedBinary = undefined;
        timedOutIdentity = undefined;
        const dataUrl = push.payload.dataUrl;
        if (dataUrl.trim() === '[redacted]') {
          fail('redacted');
          return;
        }
        if (!validateInlineJpegDataUrl(dataUrl, MAX_BROWSER_FRAME_BINARY_BYTES)) {
          fail('invalid-inline');
          return;
        }
        const jpeg = decodeInlineJpeg(dataUrl);
        if (jpeg === undefined || jpeg.byteLength !== push.byteLength) {
          fail('invalid-inline');
          return;
        }
        queueFrame(push, jpeg);
        return;
      }

      const key = browserFrameIdentityKey(push);
      const order = highWaterIdentity === undefined
        ? 1
        : browserFrameIdentityOrder(push, highWaterIdentity);
      if (order === undefined || order < 0) return;
      if (unmatchedBinary !== undefined && browserFrameIdentitiesMatch(push, unmatchedBinary.header)) {
        const jpeg = unmatchedBinary.jpeg;
        unmatchedBinary = undefined;
        timedOutIdentity = undefined;
        clearPendingMeta();
        queueFrame(push, jpeg, true);
        return;
      }
      if (order === 0) return;
      highWaterIdentity = browserFrameIdentity(push);
      if (pendingFrame !== undefined) {
        const pendingOrder = browserFrameIdentityOrder(push, pendingFrame.push);
        if (pendingOrder !== undefined && pendingOrder > 0) pendingFrame = undefined;
      }
      if (unmatchedBinary !== undefined) {
        const unmatchedOrder = browserFrameIdentityOrder(push, unmatchedBinary.header);
        if (unmatchedOrder !== undefined && unmatchedOrder > 0) unmatchedBinary = undefined;
      }
      timedOutIdentity = undefined;
      clearPendingMeta();
      pendingMeta = {
        push,
        timer: schedule(() => {
          if (pendingMeta === undefined || browserFrameIdentityKey(pendingMeta.push) !== key) return;
          pendingMeta = undefined;
          timedOutIdentity = key;
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
      if (header.sessionId !== options.sessionId || !matchesTarget(header)) return;
      const key = browserFrameIdentityKey(header);
      if (timedOutIdentity === key) return;
      if (pendingMeta !== undefined && browserFrameIdentitiesMatch(pendingMeta.push, header)) {
        const push = pendingMeta.push;
        clearPendingMeta();
        unmatchedBinary = undefined;
        queueFrame(push, jpeg, true);
        return;
      }
      const order = highWaterIdentity === undefined
        ? 1
        : browserFrameIdentityOrder(header, highWaterIdentity);
      if (order === undefined || order <= 0) return;
      if (pendingFrame !== undefined) {
        const pendingOrder = browserFrameIdentityOrder(header, pendingFrame.push);
        if (pendingOrder === undefined || pendingOrder <= 0) return;
        pendingFrame = undefined;
      }
      if (unmatchedBinary !== undefined) {
        const unmatchedOrder = browserFrameIdentityOrder(header, unmatchedBinary.header);
        if (unmatchedOrder === undefined || unmatchedOrder <= 0) return;
      }
      highWaterIdentity = browserFrameIdentity(header);
      clearPendingMeta();
      unmatchedBinary = { header, jpeg };
    },
    ingestNativePacket(bytes) {
      if (disposed) return;
      const decoded = decodeBrowserFrameBinary(bytes);
      const presentation = decoded.ok ? decoded.header.presentation : undefined;
      if (!decoded.ok || presentation === undefined) {
        fail('decode-failed');
        return;
      }
      const { header, jpeg } = decoded;
      if (header.sessionId !== options.sessionId || !matchesTarget(header)) return;
      clearPendingMeta();
      unmatchedBinary = undefined;
      timedOutIdentity = undefined;
      queueFrame({
        ...header, ...presentation, type: 'browser/frame', payload: { kind: 'binary' },
      }, jpeg);
    },
    setTarget(identity) {
      if (
        identity.generation !== target.generation ||
        identity.pageId !== target.pageId ||
        identity.documentRevision !== target.documentRevision
      ) {
        epoch += 1;
        clearFrames();
      }
      target = identity;
    },
    reportError(reason) {
      fail(reason);
    },
    getCurrentBlob() {
      return disposed ? undefined : current?.blob;
    },
    reset() {
      epoch += 1;
      clearFrames();
    },
    dispose() {
      disposed = true;
      epoch += 1;
      clearFrames();
    },
  };
}
