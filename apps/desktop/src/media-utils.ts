import {
  attachmentContentKindForFile,
  inferAttachmentMimeType,
  type AttachmentContentKind,
  type PromptAttachment,
} from '@piwin/contracts';

/**
 * Composer image UX targets (experience-first):
 * 1. Paste feels instant — local blob preview before any host I/O.
 * 2. Send never asks the user to "wait and click again" — host waits for saves.
 * 3. Large screenshots are quietly shrunk so save + model turns stay snappy.
 * 4. Failures are recoverable with one-tap retry, not a dead chip.
 */

/** Longest edge after smart resize (keeps UI text/screenshots readable). */
export const COMPOSER_IMAGE_MAX_EDGE_PX = 2048;
/** Soft size budget before we re-encode for transport + model cost. */
export const COMPOSER_IMAGE_TARGET_MAX_BYTES = 1_200_000;
export const COMPOSER_IMAGE_JPEG_QUALITY = 0.82;

/** Local composer chip lifecycle for media attachments. */
export type PendingAttachmentUploadStatus = 'queued' | 'ready' | 'saving' | 'error';

export type PendingComposerAttachment = {
  localId: string;
  attachment: PromptAttachment;
  /**
   * Object URL for local image previews. Web-element attachments have no
   * local blob; this is an empty string for `kind: 'web-element'`.
   */
  previewUrl: string;
  /**
   * Media paste/drop/file-picker save lifecycle (ADR 0045 compatibility path).
   * Pastes start `queued` — the File and blob preview stay local until Send
   * creates the destination session and runs `media/save` (`saving`), ending
   * in `ready` or `error`. Web-element chips are always treated as ready.
   */
  uploadStatus?: PendingAttachmentUploadStatus;
  /** Present when `uploadStatus` is `error`. */
  uploadError?: string;
};

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
 * Quietly shrink large paste/drop images before media/save.
 * GIFs are rasterized to their first frame for model input; the caller keeps
 * the original File object URL for the composer chip so the UI remains animated.
 * Small non-GIF images pass through.
 * Failures fall back to the original file so attach never hard-fails here.
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

  if (file.size <= COMPOSER_IMAGE_TARGET_MAX_BYTES) {
    // Still check dimensions when the browser can; a 4000px PNG can be "small" in bytes.
    const dimensions = await probeImageDimensions(file);
    if (
      !dimensions ||
      (dimensions.width <= COMPOSER_IMAGE_MAX_EDGE_PX &&
        dimensions.height <= COMPOSER_IMAGE_MAX_EDGE_PX)
    ) {
      return {
        blob: file,
        mimeType,
        byteSize: file.size,
        compressed: false,
        ...(dimensions?.width !== undefined ? { width: dimensions.width } : {}),
        ...(dimensions?.height !== undefined ? { height: dimensions.height } : {}),
      };
    }
  }

  try {
    const compressed = await compressImageBlob(file, mimeType);
    if (!compressed || compressed.byteSize >= file.size * 0.95) {
      // Compression did not help enough — keep original fidelity.
      return {
        blob: file,
        mimeType,
        byteSize: file.size,
        compressed: false,
      };
    }
    return compressed;
  } catch {
    return {
      blob: file,
      mimeType,
      byteSize: file.size,
      compressed: false,
    };
  }
}

async function probeImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return null;
    }
  }
  return null;
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

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), outputMime, COMPOSER_IMAGE_JPEG_QUALITY);
    });
    if (!blob) {
      return null;
    }

    return {
      blob,
      mimeType: outputMime,
      byteSize: blob.size,
      compressed: true,
      width: targetWidth,
      height: targetHeight,
    };
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

/**
 * Only convert paths that look like piwin media store paths.
 * Prevents turning arbitrary model/path strings into asset URLs.
 */
export function isPiwinMediaPath(absolutePath: string): boolean {
  const normalized = absolutePath.replace(/\\/g, '/');
  return (
    normalized.includes('/.piwin/media/') ||
    normalized.includes('/piwin-mock-media/') ||
    /\/media\/[A-Za-z0-9._-]+\//.test(normalized)
  );
}

export async function resolveMediaPreviewUrl(absolutePath: string): Promise<string | null> {
  if (!isPiwinMediaPath(absolutePath)) {
    return null;
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
