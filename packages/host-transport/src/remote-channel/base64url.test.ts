import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('base64url', () => {
  it('matches the RFC 4648 §10 test vectors without padding', () => {
    const vectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(encodeBase64Url(ascii(plain))).toBe(encoded);
      expect(decodeBase64Url(encoded)).toEqual(ascii(plain));
    }
  });

  it('uses the URL-safe alphabet', () => {
    expect(encodeBase64Url(Uint8Array.of(0xfb, 0xff, 0xbf))).toBe('-_-_');
    expect(decodeBase64Url('-_-_')).toEqual(Uint8Array.of(0xfb, 0xff, 0xbf));
  });

  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
  });

  it('rejects padding, foreign characters, impossible lengths and non-canonical bits', () => {
    for (const text of ['Zg==', 'Zm9v+', 'Zm9v/', 'Zm 9v', 'Z', 'Zm9vY', 'Zh', 'Zm9']) {
      expect(decodeBase64Url(text)).toBeUndefined();
    }
  });
});
