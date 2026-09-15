import { describe, expect, it } from 'vitest';
import { readJpegSize } from './jpeg-size.js';

function sof0Jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff, 0x01, 0x01, 0x11, 0x00,
  ]);
}

describe('readJpegSize', () => {
  it('reads SOF0 width and height', () => {
    expect(readJpegSize(sof0Jpeg(3840, 2400))).toEqual({ width: 3840, height: 2400 });
  });

  it('returns undefined for non-jpeg bytes', () => {
    expect(readJpegSize(new Uint8Array([0x00, 0x01]))).toBeUndefined();
    expect(readJpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeUndefined();
  });
});
