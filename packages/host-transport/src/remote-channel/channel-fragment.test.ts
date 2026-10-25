import { describe, expect, it } from 'vitest';
import {
  CHANNEL_KIND_BINARY,
  CHANNEL_KIND_TEXT,
  CHANNEL_MAX_FRAGMENT_PAYLOAD,
  ChannelReassembler,
  fragmentChannelMessage,
  type ChannelMessageKind,
} from './channel-fragment.js';
import { NOISE_MAX_PLAINTEXT_BYTES } from './noise/noise-cipher-state.js';
import { RemoteChannelError } from './remote-channel-error.js';

function roundTrip(payload: Uint8Array, kind: ChannelMessageKind = CHANNEL_KIND_TEXT) {
  const fragments = fragmentChannelMessage(kind, payload);
  const reassembler = new ChannelReassembler();
  const results = fragments.map((fragment) => reassembler.push(fragment));
  return { fragments, results };
}

const filled = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, index) => index % 251);

describe('channel fragmentation', () => {
  it('fits one fragment into one Noise transport message', () => {
    expect(CHANNEL_MAX_FRAGMENT_PAYLOAD + 2).toBe(NOISE_MAX_PLAINTEXT_BYTES);
  });

  it('sends an empty message as one final fragment', () => {
    const { fragments, results } = roundTrip(new Uint8Array(0));
    expect(fragments).toEqual([Uint8Array.of(CHANNEL_KIND_TEXT, 0)]);
    expect(results).toEqual([{ kind: CHANNEL_KIND_TEXT, payload: new Uint8Array(0) }]);
  });

  it.each([
    ['exactly one full fragment', CHANNEL_MAX_FRAGMENT_PAYLOAD, 1],
    ['one byte over a fragment', CHANNEL_MAX_FRAGMENT_PAYLOAD + 1, 2],
    ['an exact multiple of fragments', CHANNEL_MAX_FRAGMENT_PAYLOAD * 3, 3],
    ['a 1 MiB wire frame', 1_048_576, Math.ceil(1_048_576 / CHANNEL_MAX_FRAGMENT_PAYLOAD)],
  ])('round-trips %s', (_label, length, expectedFragments) => {
    const payload = filled(length);
    const { fragments, results } = roundTrip(payload, CHANNEL_KIND_BINARY);
    expect(fragments).toHaveLength(expectedFragments);
    for (const fragment of fragments) {
      expect(fragment.length).toBeLessThanOrEqual(NOISE_MAX_PLAINTEXT_BYTES);
    }
    expect(results.slice(0, -1).every((result) => result === undefined)).toBe(true);
    expect(results.at(-1)).toEqual({ kind: CHANNEL_KIND_BINARY, payload });
  });

  it('refuses to fragment a message over the frame limit', () => {
    expect(() => fragmentChannelMessage(CHANNEL_KIND_TEXT, new Uint8Array(11), 10)).toThrow(
      RemoteChannelError,
    );
  });
});

describe('ChannelReassembler', () => {
  const expectReason = (operation: () => unknown, reason: string): void => {
    try {
      operation();
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteChannelError);
      expect((error as RemoteChannelError).reason).toBe(reason);
      return;
    }
    throw new Error('expected a RemoteChannelError');
  };

  it('rejects truncated fragments, unknown kinds and unknown flags', () => {
    expectReason(
      () => new ChannelReassembler().push(Uint8Array.of(CHANNEL_KIND_TEXT)),
      'frame-invalid',
    );
    expectReason(() => new ChannelReassembler().push(Uint8Array.of(0x03, 0)), 'frame-invalid');
    expectReason(
      () => new ChannelReassembler().push(Uint8Array.of(CHANNEL_KIND_TEXT, 0x02)),
      'frame-invalid',
    );
  });

  it('rejects a kind change in the middle of a message', () => {
    const reassembler = new ChannelReassembler();
    reassembler.push(Uint8Array.of(CHANNEL_KIND_TEXT, 1, 65));
    expectReason(
      () => reassembler.push(Uint8Array.of(CHANNEL_KIND_BINARY, 0, 66)),
      'frame-invalid',
    );
  });

  it('rejects a message that grows past the limit', () => {
    const reassembler = new ChannelReassembler(4);
    reassembler.push(Uint8Array.of(CHANNEL_KIND_TEXT, 1, 1, 2, 3));
    expectReason(
      () => reassembler.push(Uint8Array.of(CHANNEL_KIND_TEXT, 0, 4, 5)),
      'frame-too-large',
    );
  });

  it('keeps consecutive messages apart', () => {
    const reassembler = new ChannelReassembler();
    expect(reassembler.push(Uint8Array.of(CHANNEL_KIND_TEXT, 0, 65))).toEqual({
      kind: CHANNEL_KIND_TEXT,
      payload: Uint8Array.of(65),
    });
    expect(reassembler.push(Uint8Array.of(CHANNEL_KIND_BINARY, 0, 66))).toEqual({
      kind: CHANNEL_KIND_BINARY,
      payload: Uint8Array.of(66),
    });
  });
});
