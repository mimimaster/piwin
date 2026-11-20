import { gunzipSync, gzipSync } from 'node:zlib';

export const DEVIN_MAX_FRAME_PAYLOAD = 64 * 1024 * 1024;
export const DEVIN_GZIP_THRESHOLD_BYTES = 8 * 1024;

export type ProtobufField = {
  number: number;
  wire: number;
  value: Buffer | bigint;
};

export type DevinFrame = {
  trailer: boolean;
  payload: Buffer;
};

export type ConnectFrameOptions = {
  forceGzip?: boolean;
};

/**
 * Frame a Connect-RPC message. Matches Devin CLI / Magpie: only payloads over
 * 8 KiB (or forced by tests) are gzipped and carry flag bit 0.
 */
export function frameConnect(payload: Uint8Array, options?: ConnectFrameOptions): Buffer {
  const shouldGzip = options?.forceGzip === true || payload.length > DEVIN_GZIP_THRESHOLD_BYTES;
  const body = shouldGzip ? gzipSync(payload) : Buffer.from(payload);
  return Buffer.concat([Buffer.from([shouldGzip ? 1 : 0]), encodeUint32(body.length), body]);
}

export function completeConnectFrames(buffer: Buffer): { bytes: Buffer; rest: Buffer } {
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const length = buffer.readUInt32BE(offset + 1);
    if (length > DEVIN_MAX_FRAME_PAYLOAD) {
      throw new Error(`Devin frame exceeds ${DEVIN_MAX_FRAME_PAYLOAD} bytes`);
    }
    if (offset + 5 + length > buffer.length) break;
    offset += 5 + length;
  }
  return { bytes: buffer.subarray(0, offset), rest: buffer.subarray(offset) };
}

export function parseConnectFrames(input: Uint8Array): DevinFrame[] {
  const buffer = Buffer.from(input);
  const frames: DevinFrame[] = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const flagByte = buffer[offset];
    if (flagByte === undefined) break;
    const length = buffer.readUInt32BE(offset + 1);
    if (length > DEVIN_MAX_FRAME_PAYLOAD) {
      throw new Error(`Devin frame exceeds ${DEVIN_MAX_FRAME_PAYLOAD} bytes`);
    }
    if (offset + 5 + length > buffer.length) break;
    let payload = buffer.subarray(offset + 5, offset + 5 + length);
    if (flagByte & 1) payload = gunzipSync(payload);
    frames.push({ trailer: Boolean(flagByte & 2), payload });
    offset += 5 + length;
  }
  return frames;
}

export function fields(buffer: Buffer): ProtobufField[] {
  const result: ProtobufField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    offset = key.offset;
    const fieldNumber = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    if (wireType === 0) {
      const value = readVarint(buffer, offset);
      offset = value.offset;
      result.push({ number: fieldNumber, wire: wireType, value: value.value });
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      if (end > buffer.length) {
        throw new Error('Invalid Devin protobuf length');
      }
      result.push({ number: fieldNumber, wire: wireType, value: buffer.subarray(offset, end) });
      offset = end;
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) {
        throw new Error('Truncated Devin protobuf fixed64');
      }
      result.push({
        number: fieldNumber,
        wire: wireType,
        value: buffer.subarray(offset, offset + 8),
      });
      offset += 8;
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) {
        throw new Error('Truncated Devin protobuf fixed32');
      }
      result.push({
        number: fieldNumber,
        wire: wireType,
        value: buffer.subarray(offset, offset + 4),
      });
      offset += 4;
    } else {
      throw new Error(`Unsupported Devin protobuf wire type ${wireType}`);
    }
  }
  return result;
}

export function readVarint(buffer: Buffer, offset: number): { value: bigint; offset: number } {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    if (byte === undefined) break;
    cursor += 1;
    value |= BigInt(byte & 127) << shift;
    if (!(byte & 128)) return { value, offset: cursor };
    shift += 7n;
    if (shift > 70n) throw new Error('Invalid Devin protobuf varint');
  }
  throw new Error('Truncated Devin protobuf varint');
}

export function concatBuffers(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

export function encodeLengthDelimited(fieldNumber: number, value: Buffer): Buffer {
  return concatBuffers(encodeKey(fieldNumber, 2), encodeVarint(value.length), value);
}

export function encodeStringField(fieldNumber: number, value: string): Buffer {
  return encodeLengthDelimited(fieldNumber, Buffer.from(value, 'utf8'));
}

export function encodeVarintField(fieldNumber: number, value: bigint): Buffer {
  return concatBuffers(encodeKey(fieldNumber, 0), encodeVarint(value));
}

export function encodeDoubleField(fieldNumber: number, value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(value);
  return concatBuffers(encodeKey(fieldNumber, 1), bytes);
}

function encodeKey(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint(BigInt((fieldNumber << 3) | wireType));
}

function encodeVarint(value: number | bigint): Buffer {
  let current = BigInt(value);
  const output: number[] = [];
  while (current > 127n) {
    output.push(Number(current & 127n) | 128);
    current >>= 7n;
  }
  output.push(Number(current));
  return Buffer.from(output);
}

function encodeUint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}
