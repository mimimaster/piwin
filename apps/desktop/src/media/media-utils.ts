import {
  attachmentContentKindForFile,
  inferAttachmentMimeType,
  type AttachmentContentKind,
  type PromptAttachment,
} from '@piwin/contracts';
import { isPiwinMediaPath } from './media-path';

export { isPiwinMediaPath };

/**
 * Composer image UX targets (experience-first):
 * 1. Paste feels instant — local blob preview before any host I/O.
 * 2. Send never asks the user to "wait and click again" — host waits for saves.
 * 3. Large screenshots are quietly shrunk so save + model turns stay snappy.
 * 4. Failures are recoverable with one-tap retry, not a dead chip.
 */

/** Longest edge after smart resize (keeps UI text/screenshots readable). */
export const COMPOSER_IMAGE_MAX_EDGE_PX = 2048;
/**
 * Soft encode budget after resize. Chunked Host upload can carry more, but
 * vision APIs (Claude ~5MB, Copilot ~2.5MB budget) prefer a smaller JPEG.
 */
export const COMPOSER_IMAGE_TARGET_MAX_BYTES = 2 * 1024 * 1024;
export const COMPOSER_IMAGE_JPEG_QUALITY = 0.82;
const COMPOSER_IMAGE_JPEG_FALLBACK_QUALITIES = [0.7, 0.58, 0.45] as const;

/** Local composer chip lifecycle for media attachments. */
export type PendingAttachmentUploadStatus = 'queued' | 'ready' | 'saving' | 'error';

/**
 * Phase 0 failure taxonomy (plan 2026-08-11 §7): `policy` is a Host-side
 * rejection (size/MIME/security), `connection` is a transport failure that
 * usually recovers with a retry, `local` is a client-side prepare/encode
 * failure. Phase 1 replaces this with contracts `AttachmentFailureCode`.
 */
export type PendingAttachmentErrorKind = 'policy' | 'connection' | 'local';

export type PendingComposerAttachment = {
  localId: string;
  attachment: PromptAttachment;
  /**
   * Display-only object URL for the chip thumb. Images use a size-capped
   * bitmap — never the original File object URL. Empty for web-element chips
   * and while the limited preview is still encoding.
   */
  previewUrl: string;
  /**
   * Original-bytes object URL for the lightbox. Distinct from `previewUrl`
   * for images. Revoke together with `previewUrl` when disposing the chip.
   */
  lightboxUrl?: string;
  /**
   * Media paste/drop/file-picker save lifecycle (ADR 0045 compatibility path).
   * Pastes start `queued` — the File and blob preview stay local until Send
   * creates the destination session and runs `media/save` (`saving`), ending
   * in `ready` or `error`. Web-element chips are always treated as ready.
   */
  uploadStatus?: PendingAttachmentUploadStatus;
  /** Present when `uploadStatus` is `error`. */
  uploadError?: string;
  /** Present when `uploadStatus` is `error`; drives the failure hint copy. */
  uploadErrorKind?: PendingAttachmentErrorKind;
};

/** Release chip object URLs. Safe when `lightboxUrl` is missing or shared. */
export function revokePendingAttachmentUrls(item: PendingComposerAttachment): void {
  if (item.previewUrl) {
    URL.revokeObjectURL(item.previewUrl);
  }
  if (item.lightboxUrl && item.lightboxUrl !== item.previewUrl) {
    URL.revokeObjectURL(item.lightboxUrl);
  }
}

export function applyChipPreviewUrl(
  items: PendingComposerAttachment[],
  localId: string,
  previewUrl: string,
): { next: PendingComposerAttachment[]; found: boolean } {
  let found = false;
  let changed = false;
  const next = items.map((item) => {
    if (item.localId !== localId) {
      return item;
    }
    found = true;
    if (item.previewUrl === previewUrl) {
      return item;
    }
    changed = true;
    return { ...item, previewUrl };
  });
  return { next: changed ? next : items, found };
}

/**
 * Write a late limited-preview URL onto the live chip list and any parked
 * composer snapshots. Revokes `previewUrl` when the chip is already gone.
 */
export function commitLimitedChipPreview(params: {
  localId: string;
  previewUrl: string;
  cancelled: boolean;
  live: PendingComposerAttachment[];
  snapshots: Iterable<{ attachments: PendingComposerAttachment[] }>;
}): { live: PendingComposerAttachment[]; keep: boolean } {
  if (params.cancelled) {
    URL.revokeObjectURL(params.previewUrl);
    return { live: params.live, keep: false };
  }
  const applied = applyChipPreviewUrl(params.live, params.localId, params.previewUrl);
  let found = applied.found;
  for (const snapshot of params.snapshots) {
    const patched = applyChipPreviewUrl(snapshot.attachments, params.localId, params.previewUrl);
    found = found || patched.found;
    snapshot.attachments = patched.next;
  }
  if (!found) {
    URL.revokeObjectURL(params.previewUrl);
    return { live: applied.next, keep: false };
  }
  return { live: applied.next, keep: true };
}

/** True when the chip is a media attachment whose save failed. */
export function isFailedMediaAttachment(item: PendingComposerAttachment): boolean {
  return item.attachment.kind === 'media' && item.uploadStatus === 'error';
}

/** True when the chip can be included in session/prompt. */
export function isPendingAttachmentReady(item: PendingComposerAttachment): boolean {
  if (item.attachment.kind !== 'media') {
    return true;
  }
  return (item.uploadStatus ?? 'ready') === 'ready';
}

/**
 * Resolve a paste/drop/file image MIME type.
 * Clipboard/Finder pastes often have empty `file.type` on macOS — sniff extension
 * and magic bytes so we still accept the image.
 */
export function resolveImageMimeType(file: File, headerBytes?: Uint8Array): string | null {
  const mimeType = inferAttachmentMimeType(file.name, file.type, headerBytes);
  return mimeType && attachmentContentKindForFile(file.name, mimeType) === 'image'
    ? mimeType
    : null;
}

export function resolveAttachmentMimeType(file: File, headerBytes?: Uint8Array): string | null {
  return inferAttachmentMimeType(file.name, file.type, headerBytes);
}

export function resolveAttachmentContentKind(
  file: File,
  mimeType?: string,
  headerBytes?: Uint8Array,
): AttachmentContentKind | null {
  return attachmentContentKindForFile(file.name, mimeType ?? file.type, headerBytes);
}

export function isAllowedImageFile(file: File): boolean {
  return resolveImageMimeType(file) !== null;
}

export function isAllowedAttachmentFile(file: File): boolean {
  return resolveAttachmentMimeType(file) !== null;
}

export type PreparedComposerImage = {
  blob: Blob;
  mimeType: string;
  byteSize: number;
  compressed: boolean;
  width?: number;
  height?: number;
};

export type PreparedComposerAttachment = PreparedComposerImage & {
  contentKind: AttachmentContentKind;
};

export async function prepareComposerAttachmentForSave(
  file: File,
  mimeType: string,
  contentKind: AttachmentContentKind,
): Promise<PreparedComposerAttachment> {
  if (contentKind !== 'image') {
    return {
      blob: file,
      mimeType,
      byteSize: file.size,
      compressed: false,
      contentKind,
    };
  }
  const prepared = await prepareComposerImageForSave(file, mimeType);
  return { ...prepared, contentKind };
}

/**
 * Compress paste/drop images as they arrive. Screenshots (often 6–7MB Retina
 * PNGs) become a 2048-edge JPEG so send never fails on size. GIFs keep the
 * first frame. If the runtime cannot decode, the original is kept when it
 * still fits Host `maxPasteBytes`.
 */
export async function prepareComposerImageForSave(
  file: File,
  mimeType: string,
): Promise<PreparedComposerImage> {
  if (mimeType === 'image/gif') {
    try {
      const firstFrame =
        (await compressImageBlob(file, mimeType)) ?? (await rasterizeGifWithImageElement(file));
      if (firstFrame) {
        return firstFrame;
      }
    } catch {
      // Keep the original GIF as a compatibility fallback when the runtime
      // cannot decode animated images. The Host still stores it safely.
    }
    return { blob: file, mimeType, byteSize: file.size, compressed: false };
  }

  try {
    const compressed = await compressImageBlob(file, mimeType);
    if (compressed && preferCompressedComposerImage(file.size, compressed.byteSize)) {
      return compressed;
    }
  } catch {
    // Decode/encode is best-effort; chunked upload can still carry the original.
  }
  return { blob: file, mimeType, byteSize: file.size, compressed: false };
}

/** Use the compressed bytes when they are actually smaller. */
export function preferCompressedComposerImage(
  originalBytes: number,
  compressedBytes: number,
): boolean {
  return compressedBytes < originalBytes;
}

export function isHostWireFrameLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Host wire frame exceeds');
}

async function compressImageBlob(
  file: File,
  sourceMimeType: string,
): Promise<PreparedComposerImage | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return null;
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      COMPOSER_IMAGE_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height, 1),
    );
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    // Screenshots with UI chrome compress well as JPEG; keep PNG only when source
    // was PNG *and* stayed under budget after resize (rare). Prefer JPEG for speed.
    const outputMime = sourceMimeType === 'image/gif' ? 'image/png' : 'image/jpeg';
    const qualities =
      outputMime === 'image/jpeg'
        ? [COMPOSER_IMAGE_JPEG_QUALITY, ...COMPOSER_IMAGE_JPEG_FALLBACK_QUALITIES]
        : [undefined];

    let best: PreparedComposerImage | null = null;
    for (const quality of qualities) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), outputMime, quality);
      });
      if (!blob) {
        continue;
      }
      const candidate: PreparedComposerImage = {
        blob,
        mimeType: outputMime,
        byteSize: blob.size,
        compressed: true,
        width: targetWidth,
        height: targetHeight,
      };
      if (!best || candidate.byteSize < best.byteSize) {
        best = candidate;
      }
      if (candidate.byteSize <= COMPOSER_IMAGE_TARGET_MAX_BYTES) {
        return candidate;
      }
    }
    return best;
  } finally {
    bitmap.close();
  }
}

/** Safari/WKWebView fallback when createImageBitmap cannot decode GIF. */
async function rasterizeGifWithImageElement(file: File): Promise<PreparedComposerImage | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('failed to decode GIF'));
      element.src = objectUrl;
    });
    const scale = Math.min(
      1,
      COMPOSER_IMAGE_MAX_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight, 1),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/png');
    });
    if (!blob) {
      return null;
    }
    return {
      blob,
      mimeType: 'image/png',
      byteSize: blob.size,
      compressed: true,
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Encode a File as raw base64 (no data-URL prefix) for `media/save`.
 *
 * Uses the browser's native FileReader path instead of a main-thread
 * `String.fromCharCode` + `btoa` loop, which freezes the UI on large pastes.
 */
export async function fileToBase64(file: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return readFileAsBase64WithFileReader(file);
  }
  // Node / unit-test fallback when FileReader is unavailable.
  return readFileAsBase64WithArrayBuffer(file);
}

function readFileAsBase64WithFileReader(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('failed to read image as data URL'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('failed to read image'));
    };
    reader.readAsDataURL(file);
  });
}

async function readFileAsBase64WithArrayBuffer(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
    // Yield periodically so large images do not monopolize the event loop.
    if (index > 0 && index % (chunkSize * 16) === 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
  return btoa(binary);
}

function convertFileSrcNow(absolutePath: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: { convertFileSrc?: (assetPath: string) => string };
    }
  ).__TAURI_INTERNALS__;
  return typeof internals?.convertFileSrc === 'function'
    ? internals.convertFileSrc(absolutePath)
    : null;
}

export async function resolveMediaPreviewUrl(absolutePath: string): Promise<string | null> {
  if (!isPiwinMediaPath(absolutePath)) {
    return null;
  }
  // Gallery already reads convertFileSrc off window so the first paint does
  // not fall through to media/read. Transcript videos cannot use that
  // fallback: the Host wire cap is ~700KB and a typical mp4 misses it.
  const sync = convertFileSrcNow(absolutePath);
  if (sync) {
    return sync;
  }
  try {
    const core = await import('@tauri-apps/api/core');
    if (typeof core.convertFileSrc === 'function') {
      // Default protocol is `asset` — matches tauri.conf.json CSP
      // (`img-src … asset: http://asset.localhost …`) and assetProtocol.scope
      // for `$HOME/.piwin/media/**`. A custom protocol like `piwinmedia`
      // is not registered and is blocked by CSP (broken-image "?" in chat).
      return core.convertFileSrc(absolutePath);
    }
  } catch {
    // browser / non-tauri
  }
  return null;
}
