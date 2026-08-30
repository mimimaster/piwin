import { describe, expect, it, vi } from 'vitest';
import { LiveSpikePeer } from './live-spike-peer.js';

function fakeTrack(kind: 'audio' = 'audio'): MediaStreamTrack {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function fakeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
  } as unknown as MediaStream;
}

class FakePeerConnection {
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  onicecandidate: ((event: { candidate: null }) => void) | null = null;
  localDescription: { type: string; sdp: string } | null = null;
  closed = false;
  addedTracks: MediaStreamTrack[] = [];

  addTrack(track: MediaStreamTrack): void {
    this.addedTracks.push(track);
  }

  async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
    return { type: 'offer', sdp: 'v=0\no=- 1 1 IN IP4 127.0.0.1\ns=-\nt=0 0\n' };
  }

  async createAnswer(): Promise<{ type: 'answer'; sdp: string }> {
    return { type: 'answer', sdp: 'v=0\no=- 2 1 IN IP4 127.0.0.1\ns=-\nt=0 0\n' };
  }

  async setLocalDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(_desc: { type: string; sdp: string }): Promise<void> {
    return;
  }

  async addIceCandidate(): Promise<void> {
    return;
  }

  close(): void {
    this.closed = true;
  }
}

describe('LiveSpikePeer', () => {
  it('maps mic denial and cleans up', async () => {
    const peer = new LiveSpikePeer({
      getUserMedia: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
      RTCPeerConnection: FakePeerConnection as unknown as typeof RTCPeerConnection,
    });

    await peer.start({ mode: 'loopback' });
    expect(peer.snapshot().phase).toBe('error');
    expect(peer.snapshot().errorCode).toBe('mic-denied');
    expect(peer.snapshot().cleanupCount).toBe(1);
  });

  it('loopback start then stop increments cleanup and ends', async () => {
    const track = fakeTrack();
    const peer = new LiveSpikePeer({
      getUserMedia: async () => fakeStream([track]),
      RTCPeerConnection: FakePeerConnection as unknown as typeof RTCPeerConnection,
    });

    await peer.start({ mode: 'loopback' });
    expect(peer.snapshot().phase).toBe('connected');
    peer.setMuted(true);
    expect(peer.snapshot().muted).toBe(true);
    expect(track.enabled).toBe(false);

    await peer.stop();
    expect(peer.snapshot().phase).toBe('ended');
    expect(peer.snapshot().cleanupCount).toBe(1);
    expect(track.stop).toHaveBeenCalled();
  });

  it('remote negotiate failure maps and cleans up', async () => {
    const track = fakeTrack();
    const peer = new LiveSpikePeer({
      getUserMedia: async () => fakeStream([track]),
      RTCPeerConnection: FakePeerConnection as unknown as typeof RTCPeerConnection,
    });

    await peer.start({
      mode: 'remote',
      negotiate: async () => {
        throw new Error('negotiate http 401');
      },
    });
    expect(peer.snapshot().phase).toBe('error');
    expect(peer.snapshot().errorCode).toBe('negotiate-failed');
    expect(track.stop).toHaveBeenCalled();
  });

  it('repeated stop is safe', async () => {
    const peer = new LiveSpikePeer({
      getUserMedia: async () => fakeStream([fakeTrack()]),
      RTCPeerConnection: FakePeerConnection as unknown as typeof RTCPeerConnection,
    });
    await peer.start({ mode: 'loopback' });
    await peer.stop();
    await peer.stop();
    expect(peer.snapshot().cleanupCount).toBeGreaterThanOrEqual(1);
    expect(peer.snapshot().phase).toBe('ended');
  });
});
