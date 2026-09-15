import { describe, expect, it } from 'vitest';
import { classifyBinaryFrameSource, readBinaryFrameBytes } from './binary-frame-bytes.js';

describe('binary frame bytes', () => {
  it('reads bytes and array buffers unchanged', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(readBinaryFrameBytes(bytes)).resolves.toEqual(bytes);
    await expect(readBinaryFrameBytes(bytes.buffer)).resolves.toEqual(bytes);
  });

  it('reads a typed-array view without copying the surrounding buffer', async () => {
    const backing = new Uint8Array([9, 9, 4, 5, 6, 9]);
    const view = backing.subarray(2, 5);
    await expect(readBinaryFrameBytes(view)).resolves.toEqual(new Uint8Array([4, 5, 6]));
  });

  it('reads the Tauri plugin number-array form', async () => {
    await expect(readBinaryFrameBytes([255, 216, 255, 217])).resolves.toEqual(
      new Uint8Array([255, 216, 255, 217]),
    );
  });

  it('awaits a Blob-like source', async () => {
    const blob = {
      arrayBuffer: async (): Promise<ArrayBuffer> => new Uint8Array([7, 8]).buffer,
    };
    await expect(readBinaryFrameBytes(blob)).resolves.toEqual(new Uint8Array([7, 8]));
  });

  it('classifies text and unknown payloads instead of guessing', async () => {
    expect(classifyBinaryFrameSource('{"type":"host/hello"}')).toEqual({ kind: 'text' });
    expect(classifyBinaryFrameSource({ nope: true })).toEqual({ kind: 'unknown' });
    await expect(readBinaryFrameBytes({ nope: true })).resolves.toBeUndefined();
  });
});
