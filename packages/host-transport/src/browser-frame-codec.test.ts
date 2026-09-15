import { describe, expect, it } from 'vitest';
import {
  BROWSER_FRAME_BINARY_MAGIC,
  BROWSER_FRAME_BINARY_VERSION,
  MAX_BROWSER_FRAME_DECODE_PIXELS,
  type BrowserFrameBinaryHeader,
} from '@piwin/contracts';
import {
  browserFrameWithinDecodeBudget,
  decodeBrowserFrameBinary,
  encodeBrowserFrameBinary,
} from './browser-frame-codec.js';

const header: BrowserFrameBinaryHeader = {
  version: BROWSER_FRAME_BINARY_VERSION,
  frameId: '7',
  generation: 3,
  pageId: 'page-1',
  documentRevision: 2,
  width: 1280,
  height: 800,
  encodedWidth: 2560,
  encodedHeight: 1600,
  byteLength: 4,
  mime: 'image/jpeg',
};

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe('browser frame binary codec', () => {
  it('round-trips a frame with its metadata', () => {
    const encoded = encodeBrowserFrameBinary(header, jpeg);
    const decoded = decodeBrowserFrameBinary(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.header.frameId).toBe('7');
    expect(decoded.header.documentRevision).toBe(2);
    expect(decoded.header.encodedWidth).toBe(2560);
    expect(Array.from(decoded.jpeg)).toEqual(Array.from(jpeg));
  });

  it('writes the declared byte length from the payload, not the caller', () => {
    const encoded = encodeBrowserFrameBinary(header, jpeg);
    const decoded = decodeBrowserFrameBinary(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.header.byteLength).toBe(jpeg.byteLength);
  });

  it('rejects a frame without the frame magic', () => {
    const encoded = encodeBrowserFrameBinary(header, jpeg);
    const tampered = Uint8Array.from(encoded);
    tampered.set([0, 0, 0, 0], 0);
    expect(decodeBrowserFrameBinary(tampered)).toEqual({ ok: false, reason: 'bad-magic' });
  });

  it('rejects a future envelope version instead of guessing', () => {
    const encoded = encodeBrowserFrameBinary(header, jpeg);
    const tampered = Uint8Array.from(encoded);
    new DataView(tampered.buffer).setUint16(4, 99, false);
    expect(decodeBrowserFrameBinary(tampered)).toEqual({
      ok: false,
      reason: 'unsupported-version',
    });
  });

  it('rejects a truncated header', () => {
    const encoded = encodeBrowserFrameBinary(header, jpeg);
    expect(decodeBrowserFrameBinary(encoded.subarray(0, 5))).toEqual({
      ok: false,
      reason: 'truncated',
    });
  });

  it('rejects a declared byte length that does not match the payload', () => {
    const encoded = encodeBrowserFrameBinary(header, jpeg);
    const view = new DataView(encoded.buffer);
    const headerLength = view.getUint16(6, false);
    const headerText = new TextDecoder().decode(
      encoded.subarray(8, 8 + headerLength),
    );
    const bumped = headerText.replace('"byteLength":4', '"byteLength":9');
    const headerBytes = new TextEncoder().encode(bumped);
    view.setUint16(6, headerBytes.byteLength, false);
    encoded.set(headerBytes, 8);
    expect(decodeBrowserFrameBinary(encoded)).toEqual({
      ok: false,
      reason: 'length-mismatch',
    });
  });

  it('rejects a non-JPEG mime and a frame beyond the decode budget', () => {
    const png = encodeBrowserFrameBinary({ ...header, mime: 'image/png' }, jpeg);
    expect(decodeBrowserFrameBinary(png)).toEqual({ ok: false, reason: 'unsupported-mime' });

    const huge = encodeBrowserFrameBinary(
      { ...header, encodedWidth: 20_000, encodedHeight: 20_000 },
      jpeg,
    );
    expect(decodeBrowserFrameBinary(huge)).toEqual({
      ok: false,
      reason: 'decode-budget-exceeded',
    });
  });

  it('keeps the constant magic stable across the wire', () => {
    expect(BROWSER_FRAME_BINARY_MAGIC).toBe(0x50424631);
  });

  it('bounds the decode budget by declared pixels', () => {
    expect(browserFrameWithinDecodeBudget(4000, 4000)).toBe(true);
    expect(browserFrameWithinDecodeBudget(MAX_BROWSER_FRAME_DECODE_PIXELS, 1)).toBe(true);
    expect(browserFrameWithinDecodeBudget(MAX_BROWSER_FRAME_DECODE_PIXELS + 1, 1)).toBe(false);
    expect(browserFrameWithinDecodeBudget(0, 10)).toBe(false);
  });
});
