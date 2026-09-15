/**
 * Binary WebSocket message normalization for the browser frame channel.
 *
 * The wire carries `Uint8Array` on the Node/Tauri path, `ArrayBuffer` from a
 * webview socket, or a plain number array from the Tauri plugin bridge. All
 * three must reach the frame decoder as bytes — a binary message must never be
 * treated as a protocol error.
 */
export type BinaryFrameSource =
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'array-buffer'; buffer: ArrayBuffer }
  | { kind: 'blob'; blob: { arrayBuffer(): Promise<ArrayBuffer> } }
  | { kind: 'number-array'; values: number[] }
  | { kind: 'text' }
  | { kind: 'unknown' };

export function classifyBinaryFrameSource(data: unknown): BinaryFrameSource {
  if (typeof data === 'string') return { kind: 'text' };
  if (data instanceof Uint8Array) return { kind: 'bytes', bytes: data };
  if (data instanceof ArrayBuffer) return { kind: 'array-buffer', buffer: data };
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return {
      kind: 'bytes',
      bytes: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    };
  }
  if (Array.isArray(data) && data.every((value) => typeof value === 'number')) {
    return { kind: 'number-array', values: data as number[] };
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  ) {
    return { kind: 'blob', blob: data as { arrayBuffer(): Promise<ArrayBuffer> } };
  }
  return { kind: 'unknown' };
}

/** Normalize any supported binary source into bytes. */
export async function readBinaryFrameBytes(data: unknown): Promise<Uint8Array | undefined> {
  const source = classifyBinaryFrameSource(data);
  switch (source.kind) {
    case 'bytes':
      return source.bytes;
    case 'array-buffer':
      return new Uint8Array(source.buffer);
    case 'blob':
      return new Uint8Array(await source.blob.arrayBuffer());
    case 'number-array': {
      const bytes = new Uint8Array(source.values.length);
      for (let index = 0; index < source.values.length; index += 1) {
        const value = source.values[index];
        bytes[index] = typeof value === 'number' ? value & 0xff : 0;
      }
      return bytes;
    }
    default:
      return undefined;
  }
}
