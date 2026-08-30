import { describe, expect, it } from 'vitest';
import {
  isPreservedNegotiateError,
  LivePeer,
  LivePeerStartError,
  waitForIceGathering,
} from './live-peer.js';

class FakePeer extends EventTarget {
  iceGatheringState: RTCIceGatheringState = 'gathering';

  complete(): void {
    this.iceGatheringState = 'complete';
    this.dispatchEvent(new Event('icegatheringstatechange'));
  }
}

describe('waitForIceGathering', () => {
  it('resolves immediately when gathering is already complete', async () => {
    const peer = new FakePeer();
    peer.iceGatheringState = 'complete';
    await waitForIceGathering(peer, new AbortController().signal, 50);
  });

  it('waits until iceGatheringState becomes complete', async () => {
    const peer = new FakePeer();
    const done = waitForIceGathering(peer, new AbortController().signal, 1_000);
    queueMicrotask(() => peer.complete());
    await done;
    expect(peer.iceGatheringState).toBe('complete');
  });

  it('rejects when aborted before complete', async () => {
    const peer = new FakePeer();
    const abort = new AbortController();
    const pending = waitForIceGathering(peer, abort.signal, 1_000);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws when the environment cannot request a microphone', async () => {
    const peer = new LivePeer();
    await expect(
      peer.start({
        negotiate: async () => ({ answerSdp: 'v=0\n' }),
        onOwnerEvent: () => undefined,
      }),
    ).rejects.toBeInstanceOf(LivePeerStartError);
    await peer.stop();
  });

  it('resolves on timeout with a partial offer rather than hanging', async () => {
    const peer = new FakePeer();
    await waitForIceGathering(peer, new AbortController().signal, 10);
    expect(peer.iceGatheringState).toBe('gathering');
  });
});

describe('isPreservedNegotiateError', () => {
  it('keeps Host create codes through a cleanup abort', () => {
    expect(isPreservedNegotiateError(new Error('live-provider-access-denied'))).toBe(true);
    expect(isPreservedNegotiateError(new LivePeerStartError('mic-denied'))).toBe(true);
    expect(isPreservedNegotiateError(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isPreservedNegotiateError(new Error('boom'))).toBe(false);
  });
});
