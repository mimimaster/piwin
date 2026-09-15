/**
 * JPEG frame byte ⇄ data-URL helpers for the local JSON frame path.
 *
 * The domain shape is bytes (spec §4.1.2); base64 exists only for transports
 * that carry the frame inside JSON.
 */
export const BROWSER_JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,';

export function toJpegDataUrl(bytes: Uint8Array): string {
  return `${BROWSER_JPEG_DATA_URL_PREFIX}${Buffer.from(bytes).toString('base64')}`;
}

/**
 * Decode a bounded JPEG data URL back to bytes. Returns undefined for a
 * mismatched prefix, an empty payload, or anything over the byte budget, so a
 * redacted or truncated URL can never be treated as an image.
 */
export function jpegBytesFromDataUrl(dataUrl: string, maxBytes: number): Uint8Array | undefined {
  const trimmed = dataUrl.trim();
  if (!trimmed.startsWith(BROWSER_JPEG_DATA_URL_PREFIX)) return undefined;
  const base64 = trimmed.slice(BROWSER_JPEG_DATA_URL_PREFIX.length);
  if (base64.length === 0) return undefined;
  // 4 base64 chars ⇒ 3 bytes; reject before allocating an oversized buffer.
  if (base64.length > Math.ceil((maxBytes / 3) * 4) + 4) return undefined;
  try {
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return undefined;
    return bytes;
  } catch {
    return undefined;
  }
}
