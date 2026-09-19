/**
 * Minimal protobuf codec for the Windsurf/Devin Connect-RPC backend.
 *
 * The wire format only needs varints (integers/enums) and length-delimited
 * values (strings, bytes, nested messages), matching the field numbers recorded
 * in `docs/specs/compactor-sdk.md` §9.6. Zero dependencies on purpose: piwin
 * must not take a protobuf runtime dependency for one optional backend.
 */

/** Field numbers are wire-visible; keep the reader tolerant of unknown ones. */
export type ProtobufField = {
  field: number;
  wireType: number;
  /** Varint value for wire type 0, raw bytes for wire type 2. */
  value: number | Buffer;
};

const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;

export class ProtobufWriter {
  private readonly chunks: Buffer[] = [];

  varint(value: number): void {
    this.chunks.push(encodeVarint(value));
  }

  tag(field: number, wireType: number): void {
    this.varint((field << 3) | wireType);
  }

  /** Write an int32/enum field (wire type 0). */
  int32(field: number, value: number): void {
    this.tag(field, WIRE_VARINT);
    this.varint(value);
  }

  /** Write a UTF-8 string field (wire type 2). */
  string(field: number, value: string): void {
    this.bytes(field, Buffer.from(value, 'utf-8'));
  }

  /** Write a raw bytes field (wire type 2). */
  bytes(field: number, value: Buffer): void {
    this.tag(field, WIRE_LENGTH_DELIMITED);
    this.varint(value.length);
    this.chunks.push(value);
  }

  /** Write a nested message field (wire type 2). */
  message(field: number, value: Buffer): void {
    this.bytes(field, value);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** Encode an unsigned varint (protobuf's base-128 little-endian form). */
export function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = Math.max(0, Math.trunc(value));
  do {
    const byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    bytes.push(remaining > 0 ? byte | 0x80 : byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

/**
 * Decode every field in a protobuf message. Unknown fields are returned too, so
 * callers can ignore what they do not model instead of failing the parse.
 */
export function decodeProtobuf(buffer: Buffer): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarintAt(buffer, offset);
    if (!tag) {
      break;
    }
    offset = tag.next;
    const field = Math.floor(tag.value / 8);
    const wireType = tag.value & 0x07;
    if (wireType === WIRE_VARINT) {
      const decoded = readVarintAt(buffer, offset);
      if (!decoded) {
        break;
      }
      fields.push({ field, wireType, value: decoded.value });
      offset = decoded.next;
      continue;
    }
    if (wireType === WIRE_LENGTH_DELIMITED) {
      const length = readVarintAt(buffer, offset);
      if (!length) {
        break;
      }
      const start = length.next;
      const end = start + length.value;
      if (end > buffer.length) {
        break;
      }
      fields.push({ field, wireType, value: buffer.subarray(start, end) });
      offset = end;
      continue;
    }
    // Wire types 1/3/4/5 are unused by this protocol; stop rather than guess.
    break;
  }
  return fields;
}

function readVarintAt(buffer: Buffer, offset: number): { value: number; next: number } | undefined {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor] ?? 0;
    value += (byte & 0x7f) * 2 ** shift;
    cursor += 1;
    if ((byte & 0x80) === 0) {
      return { value, next: cursor };
    }
    shift += 7;
    if (shift > 63) {
      return undefined;
    }
  }
  return undefined;
}

/** First varint value for a field, if present. */
export function readVarintField(fields: readonly ProtobufField[], field: number): number | undefined {
  for (const entry of fields) {
    if (entry.field === field && typeof entry.value === 'number') {
      return entry.value;
    }
  }
  return undefined;
}

/** First length-delimited value for a field, if present. */
export function readBytesField(fields: readonly ProtobufField[], field: number): Buffer | undefined {
  for (const entry of fields) {
    if (entry.field === field && Buffer.isBuffer(entry.value)) {
      return entry.value;
    }
  }
  return undefined;
}

/** First length-delimited value decoded as UTF-8 text. */
export function readStringField(fields: readonly ProtobufField[], field: number): string | undefined {
  const bytes = readBytesField(fields, field);
  return bytes ? bytes.toString('utf-8') : undefined;
}

/** Every length-delimited value for a repeated field. */
export function readRepeatedBytes(fields: readonly ProtobufField[], field: number): Buffer[] {
  const out: Buffer[] = [];
  for (const entry of fields) {
    if (entry.field === field && Buffer.isBuffer(entry.value)) {
      out.push(entry.value);
    }
  }
  return out;
}
