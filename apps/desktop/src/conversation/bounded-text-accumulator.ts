export type BoundedTextAccumulator = {
  text: string;
  retainedBytes: number;
  truncated: boolean;
};

export type BoundedTextAccumulatorOptions = {
  maximumBytes: number;
  truncationMarker: string;
};

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

function assertValidOptions(options: BoundedTextAccumulatorOptions): Uint8Array {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes <= 0) {
    throw new RangeError('maximumBytes must be a positive safe integer');
  }
  const markerBytes = UTF8_ENCODER.encode(options.truncationMarker);
  if (markerBytes.byteLength > options.maximumBytes) {
    throw new RangeError('truncationMarker must fit within maximumBytes');
  }
  return markerBytes;
}

/** Return a byte prefix that never ends inside a UTF-8 code point. */
function safeUtf8PrefixLength(bytes: Uint8Array, maximumBytes: number): number {
  if (bytes.byteLength <= maximumBytes) {
    return bytes.byteLength;
  }

  let end = maximumBytes;
  while (end > 0) {
    const firstExcludedByte = bytes[end];
    if (firstExcludedByte === undefined || (firstExcludedByte & 0xc0) !== 0x80) {
      break;
    }
    end -= 1;
  }
  return end;
}

function decodePrefix(
  bytes: Uint8Array,
  maximumBytes: number,
): {
  text: string;
  retainedBytes: number;
} {
  const retainedBytes = safeUtf8PrefixLength(bytes, maximumBytes);
  return {
    text: UTF8_DECODER.decode(bytes.subarray(0, retainedBytes)),
    retainedBytes,
  };
}

/**
 * Normalize an existing value once (for transcript hydrate or legacy state).
 * Live appends should use `appendBoundedText`; it never re-encodes the retained
 * prefix on the ordinary, below-limit path.
 */
export function createBoundedTextAccumulator(
  value: string,
  options: BoundedTextAccumulatorOptions,
): BoundedTextAccumulator {
  const markerBytes = assertValidOptions(options);
  const valueBytes = UTF8_ENCODER.encode(value);
  const alreadyTruncated = value.endsWith(options.truncationMarker);

  if (valueBytes.byteLength <= options.maximumBytes) {
    return {
      text: value,
      retainedBytes: valueBytes.byteLength,
      truncated: alreadyTruncated,
    };
  }

  const prefix = decodePrefix(valueBytes, options.maximumBytes - markerBytes.byteLength);
  return {
    text: `${prefix.text}${options.truncationMarker}`,
    retainedBytes: prefix.retainedBytes + markerBytes.byteLength,
    truncated: true,
  };
}

/**
 * Append one delta with exact UTF-8 accounting.
 *
 * The common path encodes only `delta`. If the append first crosses the cap,
 * the existing value may be encoded once to make room for the marker; after
 * that, `truncated` makes every later append a constant-time no-op.
 */
export function appendBoundedText(
  accumulator: BoundedTextAccumulator,
  delta: string,
  options: BoundedTextAccumulatorOptions,
): BoundedTextAccumulator {
  if (accumulator.truncated || delta.length === 0) {
    return accumulator;
  }

  const markerBytes = assertValidOptions(options);
  const deltaBytes = UTF8_ENCODER.encode(delta);
  if (accumulator.retainedBytes + deltaBytes.byteLength <= options.maximumBytes) {
    return {
      text: accumulator.text + delta,
      retainedBytes: accumulator.retainedBytes + deltaBytes.byteLength,
      truncated: false,
    };
  }

  const prefixBudget = options.maximumBytes - markerBytes.byteLength;
  let retainedText = accumulator.text;
  let retainedBytes = accumulator.retainedBytes;

  if (retainedBytes > prefixBudget) {
    const existingPrefix = decodePrefix(UTF8_ENCODER.encode(retainedText), prefixBudget);
    retainedText = existingPrefix.text;
    retainedBytes = existingPrefix.retainedBytes;
  } else {
    const deltaPrefix = decodePrefix(deltaBytes, prefixBudget - retainedBytes);
    retainedText += deltaPrefix.text;
    retainedBytes += deltaPrefix.retainedBytes;
  }

  return {
    text: `${retainedText}${options.truncationMarker}`,
    retainedBytes: retainedBytes + markerBytes.byteLength,
    truncated: true,
  };
}
