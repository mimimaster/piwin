/**
 * Binary browser-frame envelope (spec §4.1.2).
 *
 * Layout: magic(4) + uint16 version + uint16 headerLength + UTF-8 JSON header +
 * raw JPEG. The generic JSON wire path never carries browse pixels: a remote
 * client receives the metadata push first, then this envelope on the binary
 * channel. Every failure is a typed reason — a malformed frame must degrade the
 * mirror, never close the control connection.
 */
import {
  BROWSER_FRAME_BINARY_MAGIC,
  BROWSER_FRAME_BINARY_MIME,
  BROWSER_FRAME_BINARY_VERSION,
  BROWSER_FRAME_HEADER_MAGIC_BYTES,
  BROWSER_FRAME_MAX_HEADER_BYTES,
  MAX_BROWSER_FRAME_BINARY_BYTES,
  MAX_BROWSER_FRAME_DECODE_PIXELS,
  type BrowserFrameBinaryHeader,
} from '@piwin/contracts';

export type BrowserFrameBinaryDecodeFailure =
  | 'truncated'
  | 'bad-magic'
  | 'unsupported-version'
  | 'bad-header'
  | 'oversized'
  | 'length-mismatch'
  | 'unsupported-mime'
  | 'decode-budget-exceeded';

export type BrowserFrameBinaryDecodeResult =
  | { ok: true; header: BrowserFrameBinaryHeader; jpeg: Uint8Array }
  | { ok: false; reason: BrowserFrameBinaryDecodeFailure };

const PREFIX_BYTES = BROWSER_FRAME_HEADER_MAGIC_BYTES;
const HEADER_LENGTH_OFFSET = 6;

export function encodeBrowserFrameBinary(
  header: BrowserFrameBinaryHeader,
  jpeg: Uint8Array,
): Uint8Array {
  const headerBytes = new TextEncoder().encode(
    JSON.stringify({ ...header, version: BROWSER_FRAME_BINARY_VERSION, byteLength: jpeg.byteLength }),
  );
  if (headerBytes.byteLength > BROWSER_FRAME_MAX_HEADER_BYTES) {
    throw new Error('Browser frame header exceeds the bounded header size');
  }
  const total = PREFIX_BYTES + headerBytes.byteLength + jpeg.byteLength;
  if (total > MAX_BROWSER_FRAME_BINARY_BYTES) {
    throw new Error('Browser frame exceeds the binary channel byte limit');
  }
  const envelope = new Uint8Array(total);
  const view = new DataView(envelope.buffer);
  view.setUint32(0, BROWSER_FRAME_BINARY_MAGIC, false);
  view.setUint16(4, BROWSER_FRAME_BINARY_VERSION, false);
  view.setUint16(HEADER_LENGTH_OFFSET, headerBytes.byteLength, false);
  envelope.set(headerBytes, PREFIX_BYTES);
  envelope.set(jpeg, PREFIX_BYTES + headerBytes.byteLength);
  return envelope;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseHeader(value: unknown): BrowserFrameBinaryHeader | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const frameId = record.frameId;
  const generation = record.generation;
  const pageId = record.pageId;
  const documentRevision = record.documentRevision;
  const width = record.width;
  const height = record.height;
  const encodedWidth = record.encodedWidth;
  const encodedHeight = record.encodedHeight;
  const byteLength = record.byteLength;
  const mime = record.mime;
  const version = record.version;
  if (typeof frameId !== 'string' || frameId.length === 0 || frameId.length > 128) return undefined;
  if (!Number.isSafeInteger(generation) || (generation as number) < 0) return undefined;
  if (typeof pageId !== 'string' || pageId.length > 256) return undefined;
  if (!Number.isSafeInteger(documentRevision) || (documentRevision as number) < 0) return undefined;
  if (!isFinitePositive(width) || !isFinitePositive(height)) return undefined;
  if (!isFinitePositive(encodedWidth) || !isFinitePositive(encodedHeight)) return undefined;
  if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 0) return undefined;
  if (typeof mime !== 'string') return undefined;
  if (typeof version !== 'number') return undefined;
  return {
    version,
    frameId,
    generation: generation as number,
    pageId,
    documentRevision: documentRevision as number,
    width: width as number,
    height: height as number,
    encodedWidth: encodedWidth as number,
    encodedHeight: encodedHeight as number,
    byteLength: byteLength as number,
    mime,
  };
}

export function decodeBrowserFrameBinary(bytes: Uint8Array): BrowserFrameBinaryDecodeResult {
  if (bytes.byteLength <= PREFIX_BYTES) return { ok: false, reason: 'truncated' };
  if (bytes.byteLength > MAX_BROWSER_FRAME_BINARY_BYTES) {
    return { ok: false, reason: 'oversized' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== BROWSER_FRAME_BINARY_MAGIC) {
    return { ok: false, reason: 'bad-magic' };
  }
  if (view.getUint16(4, false) !== BROWSER_FRAME_BINARY_VERSION) {
    return { ok: false, reason: 'unsupported-version' };
  }
  const headerLength = view.getUint16(HEADER_LENGTH_OFFSET, false);
  if (headerLength === 0 || headerLength > BROWSER_FRAME_MAX_HEADER_BYTES) {
    return { ok: false, reason: 'bad-header' };
  }
  const headerEnd = PREFIX_BYTES + headerLength;
  if (bytes.byteLength <= headerEnd) return { ok: false, reason: 'truncated' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(PREFIX_BYTES, headerEnd)));
  } catch {
    return { ok: false, reason: 'bad-header' };
  }
  const header = parseHeader(parsed);
  if (!header) return { ok: false, reason: 'bad-header' };
  if (header.mime !== BROWSER_FRAME_BINARY_MIME) {
    return { ok: false, reason: 'unsupported-mime' };
  }
  const jpeg = bytes.subarray(headerEnd);
  if (jpeg.byteLength !== header.byteLength) {
    return { ok: false, reason: 'length-mismatch' };
  }
  if (!browserFrameWithinDecodeBudget(header.encodedWidth, header.encodedHeight)) {
    return { ok: false, reason: 'decode-budget-exceeded' };
  }
  return { ok: true, header, jpeg };
}

/** Guards absurd declared dimensions before any decoder sees the frame. */
export function browserFrameWithinDecodeBudget(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  return width * height <= MAX_BROWSER_FRAME_DECODE_PIXELS;
}
