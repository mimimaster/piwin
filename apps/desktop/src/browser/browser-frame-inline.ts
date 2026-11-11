import { MAX_BROWSER_FRAME_BINARY_BYTES } from '@piwin/contracts';

export const BROWSER_JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,';

/** Inline JPEG only — a redacted or non-JPEG URL must never become an `<img src>`. */
export function validateInlineJpegDataUrl(dataUrl: string, maxBytes: number): boolean {
  const trimmed = dataUrl.trim();
  if (trimmed === '[redacted]') return false;
  if (!trimmed.startsWith(BROWSER_JPEG_DATA_URL_PREFIX)) return false;
  const base64 = trimmed.slice(BROWSER_JPEG_DATA_URL_PREFIX.length);
  if (base64.length === 0) return false;
  return base64.length <= Math.ceil((maxBytes / 3) * 4) + 4;
}

export function decodeInlineJpeg(dataUrl: string): Uint8Array | undefined {
  try {
    const base64 = dataUrl.trim().slice(BROWSER_JPEG_DATA_URL_PREFIX.length);
    const binary = atob(base64);
    if (binary.length > MAX_BROWSER_FRAME_BINARY_BYTES) return undefined;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}
