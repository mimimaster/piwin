/**
 * Pure WebRTC peer controller for R1 WP1.2 spike.
 * No Session/Host/OAuth. Injectable negotiate for Host-shaped SDP exchange.
 */

export type LiveSpikePhase =
  | 'idle'
  | 'acquiring-mic'
  | 'negotiating'
  | 'connected'
  | 'ended'
  | 'error';

export type LiveSpikeErrorCode =
  | 'mic-denied'
  | 'mic-unavailable'
  | 'negotiate-failed'
  | 'peer-failed'
  | 'already-active';

export type LiveSpikeSnapshot = {
  phase: LiveSpikePhase;
  muted: boolean;
  errorCode: LiveSpikeErrorCode | null;
  remotePlaying: boolean;
  cleanupCount: number;
};

export type NegotiateAnswer = { answerSdp: string };

export type LiveSpikeNegotiate = (
  offerSdp: string,
  signal: AbortSignal,
) => Promise<NegotiateAnswer>;

export type LiveSpikePeerDeps = {
  getUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  RTCPeerConnection?: typeof RTCPeerConnection;
  now?: () => number;
};

type Listener = (snapshot: LiveSpikeSnapshot) => void;

function defaultGetUserMedia(
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('getUserMedia unavailable'));
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

export class LiveSpikePeer {
  private phase: LiveSpikePhase = 'idle';
  private muted = false;
  private errorCode: LiveSpikeErrorCode | null = null;
  private remotePlaying = false;
  private cleanupCount = 0;
  private readonly listeners = new Set<Listener>();
  private localStream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  /** Loopback answer peer — only used in loopback mode. */
  private answerPeer: RTCPeerConnection | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private abort: AbortController | null = null;
  private readonly deps: Required<LiveSpikePeerDeps>;

  constructor(deps: LiveSpikePeerDeps = {}) {
    this.deps = {
      getUserMedia: deps.getUserMedia ?? defaultGetUserMedia,
      RTCPeerConnection: deps.RTCPeerConnection ?? RTCPeerConnection,
      now: deps.now ?? (() => Date.now()),
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): LiveSpikeSnapshot {
    return {
      phase: this.phase,
      muted: this.muted,
      errorCode: this.errorCode,
      remotePlaying: this.remotePlaying,
      cleanupCount: this.cleanupCount,
    };
  }

  /**
   * Start a call.
   * - `loopback`: two local peers (mic + cleanup proof without network).
   * - `remote`: create offer and call `negotiate` (Host-shaped process).
   */
  async start(input: {
    mode: 'loopback' | 'remote';
    negotiate?: LiveSpikeNegotiate;
  }): Promise<void> {
    if (this.phase !== 'idle' && this.phase !== 'ended' && this.phase !== 'error') {
      this.fail('already-active');
      return;
    }

    await this.stopInternal({ countCleanup: false });
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.errorCode = null;
    this.muted = false;
    this.remotePlaying = false;

    try {
      this.setPhase('acquiring-mic');
      const stream = await this.deps.getUserMedia({ audio: true, video: false });
      if (signal.aborted) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.localStream = stream;

      const Peer = this.deps.RTCPeerConnection;
      this.peer = new Peer();
      for (const track of stream.getTracks()) {
        this.peer.addTrack(track, stream);
      }

      this.peer.ontrack = (event) => {
        const [remote] = event.streams;
        if (!remote) return;
        this.attachRemoteAudio(remote);
      };

      if (input.mode === 'loopback') {
        await this.runLoopback(signal);
      } else {
        if (!input.negotiate) {
          this.fail('negotiate-failed');
          return;
        }
        await this.runRemote(input.negotiate, signal);
      }

      if (signal.aborted) {
        await this.stopInternal({ countCleanup: true });
        return;
      }
      this.setPhase('connected');
    } catch (error: unknown) {
      if (signal.aborted) return;
      this.fail(mapStartError(error));
      await this.stopInternal({ countCleanup: true });
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
    this.emit();
  }

  /** Barge-in: pause remote playback without tearing down the peer. */
  bargeIn(): void {
    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remotePlaying = false;
      this.emit();
    }
  }

  resumeRemote(): void {
    if (this.remoteAudio) {
      void this.remoteAudio.play().then(
        () => {
          this.remotePlaying = true;
          this.emit();
        },
        () => {
          this.remotePlaying = false;
          this.emit();
        },
      );
    }
  }

  async stop(): Promise<void> {
    await this.stopInternal({ countCleanup: true });
    this.setPhase('ended');
  }

  dispose(): void {
    void this.stopInternal({ countCleanup: true });
    this.listeners.clear();
  }

  private async runLoopback(signal: AbortSignal): Promise<void> {
    const Peer = this.deps.RTCPeerConnection;
    if (!this.peer) throw new Error('peer missing');
    this.setPhase('negotiating');
    this.answerPeer = new Peer();
    this.answerPeer.ontrack = (event) => {
      const [remote] = event.streams;
      if (remote) this.attachRemoteAudio(remote);
    };

    // Wire ICE candidates both ways.
    this.peer.onicecandidate = (event) => {
      if (event.candidate && this.answerPeer) {
        void this.answerPeer.addIceCandidate(event.candidate);
      }
    };
    this.answerPeer.onicecandidate = (event) => {
      if (event.candidate && this.peer) {
        void this.peer.addIceCandidate(event.candidate);
      }
    };

    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    if (signal.aborted) return;
    await this.answerPeer.setRemoteDescription(offer);
    const answer = await this.answerPeer.createAnswer();
    await this.answerPeer.setLocalDescription(answer);
    await this.peer.setRemoteDescription(answer);
  }

  private async runRemote(
    negotiate: LiveSpikeNegotiate,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.peer) throw new Error('peer missing');
    this.setPhase('negotiating');
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    const offerSdp = this.peer.localDescription?.sdp;
    if (!offerSdp) throw new Error('missing local sdp');
    const { answerSdp } = await negotiate(offerSdp, signal);
    if (signal.aborted) return;
    await this.peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  private attachRemoteAudio(stream: MediaStream): void {
    if (typeof Audio === 'undefined') {
      this.remotePlaying = true;
      this.emit();
      return;
    }
    if (!this.remoteAudio) {
      this.remoteAudio = new Audio();
      this.remoteAudio.autoplay = true;
    }
    this.remoteAudio.srcObject = stream;
    void this.remoteAudio.play().then(
      () => {
        this.remotePlaying = true;
        this.emit();
      },
      () => {
        this.remotePlaying = false;
        this.emit();
      },
    );
  }

  private fail(code: LiveSpikeErrorCode): void {
    this.errorCode = code;
    this.setPhase('error');
  }

  private setPhase(phase: LiveSpikePhase): void {
    this.phase = phase;
    this.emit();
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  private async stopInternal(input: { countCleanup: boolean }): Promise<void> {
    this.abort?.abort();
    this.abort = null;

    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
    this.remotePlaying = false;

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }

    if (this.peer) {
      this.peer.onicecandidate = null;
      this.peer.ontrack = null;
      this.peer.close();
      this.peer = null;
    }
    if (this.answerPeer) {
      this.answerPeer.onicecandidate = null;
      this.answerPeer.ontrack = null;
      this.answerPeer.close();
      this.answerPeer = null;
    }

    if (input.countCleanup) this.cleanupCount += 1;
    this.muted = false;
  }
}

function mapStartError(error: unknown): LiveSpikeErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'mic-denied';
    if (error.name === 'NotFoundError' || error.name === 'NotReadableError') {
      return 'mic-unavailable';
    }
  }
  if (error instanceof Error) {
    if (/permission|notallowed/i.test(error.message)) return 'mic-denied';
    if (/device|notfound|getUserMedia/i.test(error.message)) return 'mic-unavailable';
    if (/negotiate|sdp|fetch|http/i.test(error.message)) return 'negotiate-failed';
  }
  return 'peer-failed';
}

/** Host-shaped negotiate against spike HTTP server (`host-call.ts --serve`). */
export async function negotiateViaSpikeServer(
  baseUrl: string,
  offerSdp: string,
  signal: AbortSignal,
): Promise<NegotiateAnswer> {
  const response = await fetch(new URL('/session', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offerSdp,
    signal,
  });
  if (!response.ok) {
    throw new Error(`negotiate http ${response.status}`);
  }
  const answerSdp = await response.text();
  if (!answerSdp.trim().startsWith('v=')) {
    throw new Error('negotiate missing answer sdp');
  }
  return { answerSdp };
}
