/**
 * Desktop WebRTC owner for piwin Live. Host only sees the SDP offer/answer.
 */

import {
  buildContextAppendPayloads,
  buildDelegationAckPayload,
  parseLiveChannelMessage,
} from './normalize-live-channel.js';
import type { LiveOwnerEvent } from '@piwin/contracts';

export type LivePeerPhase = 'idle' | 'acquiring-mic' | 'negotiating' | 'connected' | 'ended' | 'error';

export type LivePeerErrorCode = 'mic-denied' | 'mic-unavailable' | 'negotiate-failed' | 'peer-failed';

export type LivePeerSnapshot = {
  phase: LivePeerPhase;
  muted: boolean;
  errorCode: LivePeerErrorCode | null;
};

export type LivePeerNegotiate = (
  offerSdp: string,
  signal: AbortSignal,
) => Promise<{ answerSdp: string }>;

type Listener = (snapshot: LivePeerSnapshot) => void;

export class LivePeer {
  private phase: LivePeerPhase = 'idle';
  private muted = false;
  private errorCode: LivePeerErrorCode | null = null;
  private readonly listeners = new Set<Listener>();
  private localStream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private abort: AbortController | null = null;
  private closing = false;
  private onOwnerEvent: ((event: LiveOwnerEvent) => void) | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): LivePeerSnapshot {
    return { phase: this.phase, muted: this.muted, errorCode: this.errorCode };
  }

  async start(input: {
    negotiate: LivePeerNegotiate;
    onOwnerEvent: (event: LiveOwnerEvent) => void;
  }): Promise<void> {
    if (this.phase !== 'idle' && this.phase !== 'ended' && this.phase !== 'error') {
      throw new LivePeerStartError('peer-failed');
    }
    await this.stopInternal();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.errorCode = null;
    this.muted = false;
    this.onOwnerEvent = input.onOwnerEvent;

    try {
      this.setPhase('acquiring-mic');
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new LivePeerStartError('mic-unavailable');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (signal.aborted) {
        for (const track of stream.getTracks()) track.stop();
        throw new DOMException('aborted', 'AbortError');
      }
      this.localStream = stream;
      // Match pi-codex-voice: default RTCConfiguration, no extra STUN.
      this.peer = new RTCPeerConnection();
      for (const track of stream.getTracks()) {
        this.peer.addTrack(track, stream);
      }
      this.peer.ontrack = (event) => {
        const [remote] = event.streams;
        if (remote) this.attachRemoteAudio(remote);
      };
      this.peer.onconnectionstatechange = () => {
        if (this.closing || this.phase !== 'connected') return;
        if (this.peer?.connectionState === 'failed') {
          this.onOwnerEvent?.({ type: 'media-failed', mappedCode: 'live-protocol-failed' });
          this.fail('peer-failed');
        }
      };
      this.channel = this.peer.createDataChannel('oai-events');
      this.bindChannel(this.channel);
      this.peer.ondatachannel = (event) => this.bindChannel(event.channel);

      this.setPhase('negotiating');
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      await waitForIceGathering(this.peer, signal);
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const offerSdp = this.peer.localDescription?.sdp;
      if (!offerSdp) throw new Error('missing local sdp');
      const { answerSdp } = await input.negotiate(offerSdp, signal);
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      await this.peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      this.setPhase('connected');
    } catch (error: unknown) {
      // Host/create failures must outrank a cleanup abort. A failed start can
      // still release media and abort this peer before the UI can show 403.
      if (isPreservedNegotiateError(error)) {
        const code = error instanceof LivePeerStartError ? error.code : 'negotiate-failed';
        this.fail(code);
        await this.stopInternal();
        throw error;
      }
      if (signal.aborted || isAbortError(error)) throw new DOMException('aborted', 'AbortError');
      const code = mapStartError(error);
      this.fail(code);
      await this.stopInternal();
      throw new LivePeerStartError(code);
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

  sendDelegationAck(input: {
    providerDelegationId: string;
    ok: boolean;
    runId?: string;
    messageId?: string;
    queueId?: string;
  }): void {
    if (this.channel?.readyState === 'open') {
      this.channel.send(buildDelegationAckPayload(input));
    }
  }

  sendContextAppend(input: {
    target: 'session' | 'delegation';
    channel: 'speakable' | 'commentary';
    content: string;
    providerDelegationId?: string;
  }): void {
    if (this.channel?.readyState !== 'open') return;
    for (const payload of buildContextAppendPayloads(input)) {
      this.channel.send(payload);
    }
  }

  async stop(): Promise<void> {
    await this.stopInternal();
    this.setPhase('ended');
  }

  dispose(): void {
    void this.stopInternal();
    this.listeners.clear();
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const parsed = parseLiveChannelMessage(event.data);
      if (parsed) this.onOwnerEvent?.(parsed);
    };
  }

  private attachRemoteAudio(stream: MediaStream): void {
    if (typeof Audio === 'undefined') return;
    if (!this.remoteAudio) {
      this.remoteAudio = new Audio();
      this.remoteAudio.autoplay = true;
    }
    this.remoteAudio.srcObject = stream;
    void this.remoteAudio.play().catch(() => undefined);
  }

  private fail(code: LivePeerErrorCode): void {
    this.errorCode = code;
    this.setPhase('error');
  }

  private setPhase(phase: LivePeerPhase): void {
    this.phase = phase;
    this.emit();
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  private async stopInternal(): Promise<void> {
    this.closing = true;
    this.abort?.abort();
    this.abort = null;
    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }
    if (this.peer) {
      this.peer.onicecandidate = null;
      this.peer.ontrack = null;
      this.peer.ondatachannel = null;
      this.peer.onconnectionstatechange = null;
      this.peer.close();
      this.peer = null;
    }
    this.muted = false;
    this.onOwnerEvent = null;
    this.closing = false;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Host `live-*` codes and peer start errors survive cleanup abort. */
export function isPreservedNegotiateError(error: unknown): error is Error {
  if (!(error instanceof Error) || isAbortError(error)) return false;
  if (error instanceof LivePeerStartError) return true;
  return error.message.startsWith('live-') || error.message === 'negotiate missing answer';
}

export class LivePeerStartError extends Error {
  readonly code: LivePeerErrorCode;

  constructor(code: LivePeerErrorCode) {
    super(code);
    this.name = 'LivePeerStartError';
    this.code = code;
  }
}

/** Codex create-call is one-shot SDP; trickle ICE never reaches the Host. */
export const ICE_GATHER_TIMEOUT_MS = 8_000;

export async function waitForIceGathering(
  peer: Pick<RTCPeerConnection, 'iceGatheringState'> & EventTarget,
  signal: AbortSignal,
  timeoutMs = ICE_GATHER_TIMEOUT_MS,
): Promise<void> {
  if (peer.iceGatheringState === 'complete') return;
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (next: () => void): void => {
      if (settled) return;
      settled = true;
      peer.removeEventListener('icegatheringstatechange', onChange);
      signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      next();
    };
    const onChange = (): void => {
      if (peer.iceGatheringState === 'complete') finish(() => resolve());
    };
    const onAbort = (): void => {
      finish(() => reject(new DOMException('aborted', 'AbortError')));
    };
    peer.addEventListener('icegatheringstatechange', onChange);
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => finish(() => resolve()), timeoutMs);
    if (peer.iceGatheringState === 'complete') finish(() => resolve());
  });
}

function mapStartError(error: unknown): LivePeerErrorCode {
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
