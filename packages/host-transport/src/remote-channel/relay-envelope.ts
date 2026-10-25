import { REMOTE_CHANNEL_MAX_FRAME_BYTES } from '@piwin/contracts';
import { copyBytes } from './byte-arrays.js';

/** Bytes of the big-endian peer id in front of every relay frame. */
export const RELAY_PEER_PREFIX_BYTES = 4;
const MAX_PEER_ID = 0xffff_ffff;

export type RelayFrame = {
  /** 0 on frames a client sends (the relay overwrites it); the target peer on Host frames. */
  peer: number;
  payload: Uint8Array;
};

/** `[peer:u32 BE][payload]`; throws when the frame would exceed the relay limit. */
export function packRelayFrame(peer: number, payload: Uint8Array): Uint8Array {
  assertPeerId(peer);
  if (RELAY_PEER_PREFIX_BYTES + payload.length > REMOTE_CHANNEL_MAX_FRAME_BYTES) {
    throw new RangeError('Relay frame exceeds the maximum frame size');
  }
  const frame = new Uint8Array(RELAY_PEER_PREFIX_BYTES + payload.length);
  new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(0, peer, false);
  frame.set(payload, RELAY_PEER_PREFIX_BYTES);
  return frame;
}

/** Undefined for a frame too short to carry a prefix or longer than the relay limit. */
export function unpackRelayFrame(frame: Uint8Array): RelayFrame | undefined {
  if (frame.length < RELAY_PEER_PREFIX_BYTES || frame.length > REMOTE_CHANNEL_MAX_FRAME_BYTES) {
    return undefined;
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return {
    peer: view.getUint32(0, false),
    payload: frame.subarray(RELAY_PEER_PREFIX_BYTES),
  };
}

/**
 * Returns a copy of `frame` stamped with `peer`. The relay does this to every
 * client frame so a client can never claim to be another peer.
 */
export function rewriteRelayFramePeer(frame: Uint8Array, peer: number): Uint8Array {
  assertPeerId(peer);
  if (frame.length < RELAY_PEER_PREFIX_BYTES) {
    throw new RangeError('Relay frame is shorter than its peer prefix');
  }
  const copy = copyBytes(frame);
  new DataView(copy.buffer, copy.byteOffset, copy.byteLength).setUint32(0, peer, false);
  return copy;
}

function assertPeerId(peer: number): void {
  if (!Number.isInteger(peer) || peer < 0 || peer > MAX_PEER_ID) {
    throw new RangeError('Relay peer id must be an unsigned 32-bit integer');
  }
}
