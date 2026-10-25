import { HOST_WIRE_HARD_FRAME_BYTES } from '../protocol-codec.js';
import { NOISE_MAX_PLAINTEXT_BYTES } from './noise/noise-cipher-state.js';
import { RemoteChannelError } from './remote-channel-error.js';

/** In-channel message kinds (ADR 0101 §4). */
export const CHANNEL_KIND_TEXT = 0x01;
export const CHANNEL_KIND_BINARY = 0x02;
export type ChannelMessageKind = typeof CHANNEL_KIND_TEXT | typeof CHANNEL_KIND_BINARY;

const HEADER_BYTES = 2;
const FLAG_MORE = 0x01;
/** One fragment fills one Noise transport message exactly. */
export const CHANNEL_MAX_FRAGMENT_PAYLOAD = NOISE_MAX_PLAINTEXT_BYTES - HEADER_BYTES;

export type ChannelMessage = { kind: ChannelMessageKind; payload: Uint8Array };

/** Splits one message into `[kind][flags][payload]` fragments; an empty message is one fragment. */
export function fragmentChannelMessage(
  kind: ChannelMessageKind,
  payload: Uint8Array,
  maxMessageBytes = HOST_WIRE_HARD_FRAME_BYTES,
): Uint8Array[] {
  if (payload.length > maxMessageBytes) {
    throw new RemoteChannelError('frame-too-large', 'Channel message exceeds the frame limit');
  }
  const fragments: Uint8Array[] = [];
  let offset = 0;
  do {
    const end = Math.min(offset + CHANNEL_MAX_FRAGMENT_PAYLOAD, payload.length);
    const fragment = new Uint8Array(HEADER_BYTES + (end - offset));
    fragment[0] = kind;
    fragment[1] = end < payload.length ? FLAG_MORE : 0;
    fragment.set(payload.subarray(offset, end), HEADER_BYTES);
    fragments.push(fragment);
    offset = end;
  } while (offset < payload.length);
  return fragments;
}

/**
 * Rebuilds messages from fragments in order. Any malformed fragment — unknown
 * kind or flag, a kind change mid-message, overflow — is a channel error.
 */
export class ChannelReassembler {
  private readonly maxMessageBytes: number;
  private pendingKind: ChannelMessageKind | undefined;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;

  public constructor(maxMessageBytes = HOST_WIRE_HARD_FRAME_BYTES) {
    this.maxMessageBytes = maxMessageBytes;
  }

  public push(fragment: Uint8Array): ChannelMessage | undefined {
    if (fragment.length < HEADER_BYTES) {
      throw new RemoteChannelError('frame-invalid', 'Channel fragment is truncated');
    }
    const kind = fragment[0];
    const flags = fragment[1] ?? 0;
    if (kind !== CHANNEL_KIND_TEXT && kind !== CHANNEL_KIND_BINARY) {
      throw new RemoteChannelError('frame-invalid', 'Unknown channel message kind');
    }
    if ((flags & ~FLAG_MORE) !== 0) {
      throw new RemoteChannelError('frame-invalid', 'Unknown channel fragment flags');
    }
    if (this.pendingKind !== undefined && this.pendingKind !== kind) {
      throw new RemoteChannelError('frame-invalid', 'Channel message kind changed mid-message');
    }
    const body = fragment.subarray(HEADER_BYTES);
    this.pendingBytes += body.length;
    if (this.pendingBytes > this.maxMessageBytes) {
      throw new RemoteChannelError('frame-too-large', 'Channel message exceeds the frame limit');
    }
    this.pendingKind = kind;
    this.pending.push(body.slice());
    if ((flags & FLAG_MORE) !== 0) {
      return undefined;
    }
    const payload = new Uint8Array(this.pendingBytes);
    let offset = 0;
    for (const part of this.pending) {
      payload.set(part, offset);
      offset += part.length;
    }
    this.pendingKind = undefined;
    this.pending = [];
    this.pendingBytes = 0;
    return { kind, payload };
  }
}
