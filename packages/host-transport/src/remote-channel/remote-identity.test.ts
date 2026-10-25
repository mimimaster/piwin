import { describe, expect, it } from 'vitest';
import { isRemoteId } from '@piwin/contracts';
import {
  deriveHostId,
  deriveUserId,
  normalizeRemoteDisplayName,
  remoteChannelPrologue,
} from './remote-identity.js';

const SEQUENTIAL_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const ALL_ONES_KEY = new Uint8Array(32).fill(0xff);

describe('remote id derivation', () => {
  // Golden values computed independently with Python hashlib:
  // base64url(sha256(domain || key)[:16]) without padding.
  it('matches independently computed user and host ids', () => {
    expect(deriveUserId(SEQUENTIAL_KEY)).toBe('hgZeC8lPeoRAWbGyRA3Big');
    expect(deriveHostId(SEQUENTIAL_KEY)).toBe('ciEDxFTJXS9L7jBJQF9vqw');
    expect(deriveUserId(ALL_ONES_KEY)).toBe('9mQlHVq04WnACPATCL6KiQ');
  });

  it('separates domains so one key never yields the same user and host id', () => {
    expect(deriveUserId(SEQUENTIAL_KEY)).not.toBe(deriveHostId(SEQUENTIAL_KEY));
  });

  it('produces ids the contract accepts', () => {
    expect(isRemoteId(deriveUserId(ALL_ONES_KEY))).toBe(true);
    expect(isRemoteId(deriveHostId(ALL_ONES_KEY))).toBe(true);
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => deriveUserId(new Uint8Array(31))).toThrow();
    expect(() => deriveHostId(new Uint8Array(33))).toThrow();
  });
});

describe('remoteChannelPrologue', () => {
  it('is the domain tag followed by both ids', () => {
    const prologue = new TextDecoder().decode(
      remoteChannelPrologue('u'.repeat(22), 'h'.repeat(22)),
    );
    expect(prologue).toBe(`piwin-channel-v1\0${'u'.repeat(22)}${'h'.repeat(22)}`);
  });

  it('differs when either id differs', () => {
    const base = remoteChannelPrologue('a'.repeat(22), 'b'.repeat(22));
    expect(remoteChannelPrologue('a'.repeat(22), 'c'.repeat(22))).not.toEqual(base);
    expect(remoteChannelPrologue('c'.repeat(22), 'b'.repeat(22))).not.toEqual(base);
  });
});

describe('normalizeRemoteDisplayName', () => {
  it('normalizes to NFC and trims whitespace', () => {
    expect(normalizeRemoteDisplayName('  Café  ')).toBe('Café');
  });

  it('removes control and format characters and collapses whitespace', () => {
    expect(normalizeRemoteDisplayName('Yorick\u0000​ 的\n\tMac')).toBe('Yorick 的 Mac');
  });

  it('caps the length in code points, not UTF-16 units', () => {
    const name = normalizeRemoteDisplayName('😀'.repeat(80));
    expect(Array.from(name ?? '')).toHaveLength(64);
  });

  it('returns undefined when nothing printable remains', () => {
    expect(normalizeRemoteDisplayName(' \u0000\n ')).toBeUndefined();
  });
});
