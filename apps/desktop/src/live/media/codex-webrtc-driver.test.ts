import { describe, expect, it } from 'vitest';
import type { LivePeer } from '../live-peer.js';
import { createCodexWebrtcDriver } from './codex-webrtc-driver.js';

describe('Codex WebRTC driver cancellation', () => {
  it('close does not wait for an unanswerable microphone prompt', async () => {
    let release: (() => void) | undefined;
    let stopped = false;
    const peer = {
      start: () => new Promise<void>((resolve) => { release = resolve; }),
      stop: async () => { stopped = true; },
    } as unknown as LivePeer;
    const driver = createCodexWebrtcDriver(peer);
    const offer = driver.prepareStart();
    const rejected = expect(offer).rejects.toMatchObject({ name: 'AbortError' });
    await driver.close();
    await rejected;
    expect(stopped).toBe(true);
    release?.();
  });

  it('observes microphone failure even if connect is never called', async () => {
    const peer = { start: async () => { throw new Error('mic-denied'); }, stop: async () => undefined } as unknown as LivePeer;
    const driver = createCodexWebrtcDriver(peer);
    await expect(driver.prepareStart()).rejects.toThrow('mic-denied');
    await driver.close();
  });
});
