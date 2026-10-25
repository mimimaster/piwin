/** Joins byte arrays into one new array. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * A detached copy. Not `bytes.slice()`: on a Node `Buffer` (what `ws` hands
 * out) `slice` returns a view into shared pool memory, not a copy.
 */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
