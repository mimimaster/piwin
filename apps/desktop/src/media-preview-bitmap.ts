/**
 * Bound decoded-pixel cost of on-screen thumbs. CSS display size does not
 * stop WebKit from decoding the full bitmap; a separate small blob does.
 */

export const COMPOSER_THUMB_MAX_EDGE_PX = 96;
export const TRANSCRIPT_THUMB_MAX_EDGE_PX = 1024;

export type LimitedPreviewUrl = {
  url: string;
  /** True when `url` is an object URL this helper created and the caller must revoke. */
  owned: boolean;
};

function warnPreviewFailure(error: unknown): void {
  console.warn('[media-preview] limited decode failed; using original', error);
}

export function scaleToMaxEdge(
  width: number,
  height: number,
  maxEdgePx: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdgePx) {
    return { width, height };
  }
  const scale = maxEdgePx / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function bitmapToObjectUrl(bitmap: ImageBitmap): Promise<string | null> {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.drawImage(bitmap, 0, 0);
  const blob = await canvasToPreviewBlob(canvas);
  if (!blob) {
    return null;
  }
  return URL.createObjectURL(blob);
}

async function canvasToPreviewBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (typeof canvas.toBlob !== 'function') {
    return null;
  }
  for (const type of ['image/webp', 'image/jpeg'] as const) {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((next) => resolve(next), type, 0.8);
    });
    if (blob) {
      return blob;
    }
  }
  return null;
}

function asBitmapSource(blob: Blob): Blob {
  // Some test DOMs reject `File` even though it extends Blob. A plain Blob
  // keeps the same bytes and is what WKWebView accepts either way.
  if (typeof File !== 'undefined' && blob instanceof File) {
    return new Blob([blob], { type: blob.type });
  }
  return blob;
}

async function constrainBitmapToMaxEdge(
  bitmap: ImageBitmap,
  maxEdgePx: number,
): Promise<ImageBitmap> {
  const scaled = scaleToMaxEdge(bitmap.width, bitmap.height, maxEdgePx);
  if (scaled.width === bitmap.width && scaled.height === bitmap.height) {
    return bitmap;
  }
  if (typeof document === 'undefined') {
    return bitmap;
  }
  const canvas = document.createElement('canvas');
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return bitmap;
  }
  context.drawImage(bitmap, 0, 0, scaled.width, scaled.height);
  bitmap.close();
  return createImageBitmap(canvas);
}

async function decodeLimitedBitmap(blob: Blob, maxEdgePx: number): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('createImageBitmap unavailable');
  }
  const source = asBitmapSource(blob);
  let bitmap: ImageBitmap;
  try {
    // Width-only resize keeps landscape cheap. Portrait still comes back
    // taller than maxEdge; constrainBitmapToMaxEdge finishes the job.
    bitmap = await createImageBitmap(source, {
      resizeWidth: maxEdgePx,
      resizeQuality: 'low',
    });
  } catch {
    bitmap = await createImageBitmap(source);
  }
  return constrainBitmapToMaxEdge(bitmap, maxEdgePx);
}

/**
 * Build a display-only object URL whose decoded size is capped at `maxEdgePx`.
 * On any failure returns an object URL of the original blob so the chip still paints.
 */
export async function createLimitedPreviewUrl(
  source: Blob,
  maxEdgePx: number,
): Promise<LimitedPreviewUrl> {
  try {
    const bitmap = await decodeLimitedBitmap(source, maxEdgePx);
    try {
      const url = await bitmapToObjectUrl(bitmap);
      if (url) {
        return { url, owned: true };
      }
    } finally {
      bitmap.close();
    }
  } catch (error) {
    warnPreviewFailure(error);
  }
  return { url: URL.createObjectURL(source), owned: true };
}

/**
 * Same as `createLimitedPreviewUrl` for an already-resolved href (`asset:`, blob:, https:).
 * Failure returns the original href and does not create a new object URL.
 */
export async function createLimitedPreviewUrlFromHref(
  href: string,
  maxEdgePx: number,
): Promise<LimitedPreviewUrl> {
  try {
    const response = await fetch(href);
    if (!response.ok) {
      return { url: href, owned: false };
    }
    const blob = await response.blob();
    return await createLimitedPreviewUrl(blob, maxEdgePx);
  } catch (error) {
    warnPreviewFailure(error);
    return { url: href, owned: false };
  }
}

function bitmapToDataUrl(bitmap: ImageBitmap): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.toDataURL !== 'function') {
    return null;
  }
  context.drawImage(bitmap, 0, 0);
  for (const type of ['image/webp', 'image/jpeg'] as const) {
    const url = canvas.toDataURL(type, 0.8);
    // A browser that cannot encode `type` silently returns a PNG data URL.
    if (url.startsWith('data:image/')) {
      return url;
    }
  }
  return null;
}

/**
 * Size-capped still as a self-contained `data:` URL, for consumers that cannot
 * read a host-origin object URL — an Artifact sandbox runs on an opaque origin
 * and a `blob:` src errors there instead of painting.
 */
export async function createLimitedDataUrl(
  source: Blob,
  maxEdgePx: number,
): Promise<string | null> {
  try {
    const bitmap = await decodeLimitedBitmap(source, maxEdgePx);
    try {
      return bitmapToDataUrl(bitmap);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    warnPreviewFailure(error);
    return null;
  }
}

/** Same as `createLimitedDataUrl` for an already-resolved href (`blob:`, `asset:`, https:). */
export async function createLimitedDataUrlFromHref(
  href: string,
  maxEdgePx: number,
): Promise<string | null> {
  try {
    const response = await fetch(href);
    if (!response.ok) {
      return null;
    }
    return await createLimitedDataUrl(await response.blob(), maxEdgePx);
  } catch (error) {
    warnPreviewFailure(error);
    return null;
  }
}

/**
 * Lightbox keeps the original File object URL (not decoded until opened).
 * The chip `onReady` URL is a size-capped still. Caller must revoke both.
 */
export function beginComposerImagePreview(
  file: File,
  onReady: (previewUrl: string) => void,
  isCancelled: () => boolean,
): { lightboxUrl: string } {
  const lightboxUrl = URL.createObjectURL(file);
  void createLimitedPreviewUrl(file, COMPOSER_THUMB_MAX_EDGE_PX).then((result) => {
    if (isCancelled()) {
      if (result.owned) {
        URL.revokeObjectURL(result.url);
      }
      return;
    }
    onReady(result.url);
  });
  return { lightboxUrl };
}
