// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileWebrtcLiveDriver } from './mobile-webrtc-live-driver.js';

afterEach(() => vi.unstubAllGlobals());

describe('Mobile WebRTC cleanup', () => {
  it('stops a microphone stream granted after cancellation without creating a peer', async () => {
    let grant: ((stream: MediaStream) => void) | undefined;
    const stop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise<MediaStream>((resolve) => { grant = resolve; }) } });
    const createPeer = vi.fn();
    vi.stubGlobal('RTCPeerConnection', createPeer);
    const driver = createMobileWebrtcLiveDriver();
    const preparing = driver.prepareStart();
    const rejection = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    await driver.close();
    grant?.({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await rejection;
    expect(stop).toHaveBeenCalledOnce();
    expect(createPeer).not.toHaveBeenCalled();
    expect(driver.snapshot().phase).toBe('ended');
  });
});
