const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const DECODE = new Map<string, number>([...ALPHABET].map((char, index) => [char, index]));

/** Unpadded base64url (RFC 4648 §5). Portable: no Buffer, no atob. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let out = '';
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const chunk =
      (byteAt(bytes, index) << 16) | (byteAt(bytes, index + 1) << 8) | byteAt(bytes, index + 2);
    out += charAt(chunk >> 18) + charAt(chunk >> 12) + charAt(chunk >> 6) + charAt(chunk);
  }
  const rest = bytes.length - index;
  if (rest === 1) {
    const chunk = byteAt(bytes, index) << 16;
    out += charAt(chunk >> 18) + charAt(chunk >> 12);
  } else if (rest === 2) {
    const chunk = (byteAt(bytes, index) << 16) | (byteAt(bytes, index + 1) << 8);
    out += charAt(chunk >> 18) + charAt(chunk >> 12) + charAt(chunk >> 6);
  }
  return out;
}

/**
 * Strict decode: rejects padding, foreign characters, impossible lengths and
 * non-canonical trailing bits, so one key has exactly one spelling.
 */
export function decodeBase64Url(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) {
    return undefined;
  }
  const values: number[] = [];
  for (const char of text) {
    const value = DECODE.get(char);
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  const out = new Uint8Array(Math.floor((values.length * 3) / 4));
  let written = 0;
  for (let index = 0; index < values.length; index += 4) {
    const a = values[index] ?? 0;
    const b = values[index + 1] ?? 0;
    const c = values[index + 2] ?? 0;
    const d = values[index + 3] ?? 0;
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    const available = Math.min(4, values.length - index);
    if (available === 2 && (b & 0x0f) !== 0) return undefined;
    if (available === 3 && (c & 0x03) !== 0) return undefined;
    out[written++] = (chunk >> 16) & 0xff;
    if (available > 2) out[written++] = (chunk >> 8) & 0xff;
    if (available > 3) out[written++] = chunk & 0xff;
  }
  return out;
}

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function charAt(sextet: number): string {
  return ALPHABET.charAt(sextet & 0x3f);
}
