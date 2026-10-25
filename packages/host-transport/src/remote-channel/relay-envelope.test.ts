import { describe, expect, it } from 'vitest';
import { REMOTE_CHANNEL_MAX_FRAME_BYTES } from '@piwin/contracts';
import {
  RELAY_PEER_PREFIX_BYTES,
  packRelayFrame,
  rewriteRelayFramePeer,
  unpackRelayFrame,
} from './relay-envelope.js';

describe('relay envelope', () => {
  it('prefixes the payload with a big-endian u32 peer id', () => {
    const frame = packRelayFrame(0x01020304, Uint8Array.of(9, 8));
    expect(Array.from(frame)).toEqual([1, 2, 3, 4, 9, 8]);
    expect(unpackRelayFrame(frame)).toEqual({ peer: 0x01020304, payload: Uint8Array.of(9, 8) });
  });

  it('accepts the full peer range and an empty payload', () => {
    expect(unpackRelayFrame(packRelayFrame(0, new Uint8Array(0)))).toEqual({
      peer: 0,
      payload: new Uint8Array(0),
    });
    expect(unpackRelayFrame(packRelayFrame(0xffff_ffff, Uint8Array.of(1)))?.peer).toBe(0xffff_ffff);
  });

  it('unpacks frames that are views into a larger buffer', () => {
    const backing = new Uint8Array(16);
    backing.set([0, 0, 0, 7, 42], 5);
    expect(unpackRelayFrame(backing.subarray(5, 10))).toEqual({
      peer: 7,
      payload: Uint8Array.of(42),
    });
  });

  it('enforces the relay frame limit on both sides', () => {
    const fits = new Uint8Array(REMOTE_CHANNEL_MAX_FRAME_BYTES - RELAY_PEER_PREFIX_BYTES);
    expect(packRelayFrame(1, fits)).toHaveLength(REMOTE_CHANNEL_MAX_FRAME_BYTES);
    expect(() => packRelayFrame(1, new Uint8Array(fits.length + 1))).toThrow(RangeError);
    expect(unpackRelayFrame(new Uint8Array(REMOTE_CHANNEL_MAX_FRAME_BYTES + 1))).toBeUndefined();
  });

  it('rejects frames shorter than the prefix and invalid peer ids', () => {
    expect(unpackRelayFrame(Uint8Array.of(0, 0, 1))).toBeUndefined();
    for (const peer of [-1, 1.5, 0x1_0000_0000, Number.NaN]) {
      expect(() => packRelayFrame(peer, new Uint8Array(0))).toThrow(RangeError);
    }
  });

  it('rewrites the peer on a copy, so a client cannot spoof another peer', () => {
    const forged = packRelayFrame(99, Uint8Array.of(5));
    const stamped = rewriteRelayFramePeer(forged, 3);
    expect(unpackRelayFrame(stamped)).toEqual({ peer: 3, payload: Uint8Array.of(5) });
    expect(unpackRelayFrame(forged)?.peer).toBe(99);
    expect(() => rewriteRelayFramePeer(Uint8Array.of(1), 3)).toThrow(RangeError);
  });
});
