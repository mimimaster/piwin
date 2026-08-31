import {
  LIVE_DELEGATION_INSTRUCTION_MAX_BYTES,
  waitForLiveMediaReady,
  type LiveClientBootstrapInput,
  type LiveOwnerActionPush,
  type LiveOwnerBootstrap,
  type LiveOwnerEvent,
} from '@piwin/contracts';
import { codexContextAppendPayloads, codexDelegationAckPayload } from './live-wire.js';
import type {
  MobileLiveMediaDriver,
  MobileLivePeerErrorCode,
  MobileLivePeerPhase,
  MobileLivePeerSnapshot,
} from './mobile-live-media-driver.js';

const ICE_GATHER_TIMEOUT_MS = 8_000;

export function createMobileWebrtcLiveDriver(): MobileLiveMediaDriver {
  const snapshotListeners = new Set<(snapshot: MobileLivePeerSnapshot) => void>();
  const eventListeners = new Set<(event: LiveOwnerEvent) => void>();
  let phase: MobileLivePeerPhase = 'idle';
  let muted = false;
  let errorCode: MobileLivePeerErrorCode | null = null;
  let localStream: MediaStream | null = null;
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let remoteAudio: HTMLAudioElement | null = null;
  let startAbort: AbortController | null = null;
  let closing = false;

  function snapshot(): MobileLivePeerSnapshot {
    return { phase, muted, errorCode };
  }

  function emitSnapshot(): void {
    const next = snapshot();
    for (const listener of snapshotListeners) listener(next);
  }

  function emitEvent(event: LiveOwnerEvent): void {
    for (const listener of eventListeners) listener(event);
  }

  function setPhase(next: MobileLivePeerPhase): void {
    phase = next;
    emitSnapshot();
  }

  return {
    id: 'codex-webrtc-v1',
    isSupported() {
      return typeof RTCPeerConnection === 'function';
    },
    snapshot,
    subscribe(listener) {
      snapshotListeners.add(listener);
      listener(snapshot());
      return () => snapshotListeners.delete(listener);
    },
    async prepareStart(): Promise<LiveClientBootstrapInput> {
      if (phase !== 'idle' && phase !== 'ended' && phase !== 'error') {
        throw new Error('live-protocol-failed');
      }
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('mic-unavailable');
      }
      closing = false;
      startAbort = new AbortController();
      const signal = startAbort.signal;
      errorCode = null;
      muted = false;
      setPhase('acquiring-mic');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (signal.aborted) {
          for (const track of stream.getTracks()) track.stop();
          throw new DOMException('aborted', 'AbortError');
        }
        localStream = stream;
        peer = new RTCPeerConnection();
        for (const track of localStream.getTracks()) peer.addTrack(track, localStream);
        peer.ontrack = (event) => {
          const [stream] = event.streams;
          if (stream) attachRemoteAudio(stream);
        };
        peer.onconnectionstatechange = () => {
          if (closing || phase !== 'connected') return;
          if (peer?.connectionState === 'failed') {
            fail('peer-failed');
            emitEvent({ type: 'media-failed', mappedCode: 'live-protocol-failed' });
          }
        };
        channel = peer.createDataChannel('oai-events');
        bindChannel(channel);
        peer.ondatachannel = (event) => bindChannel(event.channel);
        setPhase('negotiating');
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await waitForIceGathering(peer, signal);
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        const offerSdp = peer.localDescription?.sdp;
        if (!offerSdp) throw new Error('missing local sdp');
        return { mediaDriverId: 'codex-webrtc-v1', offerSdp };
      } catch (error: unknown) {
        if (isAbortError(error)) throw error;
        const code = mapMediaError(error);
        fail(code);
        await closeResources();
        throw new Error(code);
      }
    },
    async connect(bootstrap: LiveOwnerBootstrap, signal: AbortSignal): Promise<void> {
      if (bootstrap.mediaDriverId !== 'codex-webrtc-v1') throw new Error('live-media-unsupported');
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const currentPeer = peer;
      const currentChannel = channel;
      const abort = startAbort;
      if (!currentPeer || !currentChannel || !abort) throw new Error('live-protocol-failed');
      const onAbort = (): void => abort.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        await currentPeer.setRemoteDescription({ type: 'answer', sdp: bootstrap.answerSdp });
        await waitForLiveMediaReady({
          signal: abort.signal,
          read: () => currentPeer.connectionState === 'failed' || currentPeer.connectionState === 'closed' || currentChannel.readyState === 'closed'
            ? 'failed' : currentPeer.connectionState === 'connected' && currentChannel.readyState === 'open' ? 'ready' : 'pending',
          subscribe: (listener) => {
            currentPeer.addEventListener('connectionstatechange', listener);
            currentChannel.addEventListener('open', listener);
            currentChannel.addEventListener('close', listener);
            return () => {
              currentPeer.removeEventListener('connectionstatechange', listener);
              currentChannel.removeEventListener('open', listener);
              currentChannel.removeEventListener('close', listener);
            };
          },
        });
        setPhase('connected');
        emitEvent({ type: 'media-active' });
      } catch (error) {
        if (!isAbortError(error)) fail('negotiate-failed');
        await closeResources();
        throw error;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
    setMuted(nextMuted) {
      muted = nextMuted;
      for (const track of localStream?.getAudioTracks() ?? []) track.enabled = !nextMuted;
      emitSnapshot();
    },
    async handleOwnerAction(action: LiveOwnerActionPush): Promise<void> {
      if (action.action === 'release-media') {
        await this.close();
        return;
      }
      if (
        action.action === 'ack-delegation' &&
        action.providerDelegationId &&
        channel?.readyState === 'open'
      ) {
        channel.send(
          codexDelegationAckPayload({
            providerDelegationId: action.providerDelegationId,
            ok: action.ok === true,
            ...(action.runId ? { runId: action.runId } : {}),
            ...(action.messageId ? { messageId: action.messageId } : {}),
            ...(action.queueId ? { queueId: action.queueId } : {}),
          }),
        );
        return;
      }
      if (action.action === 'append-context' && action.content) {
        sendContext({
          target: action.target === 'delegation' ? 'delegation' : 'session',
          channel: action.channel === 'commentary' ? 'commentary' : 'speakable',
          content: action.content,
          ...(action.providerDelegationId
            ? { providerDelegationId: action.providerDelegationId }
            : {}),
        });
      }
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    appendContext(input) {
      sendContext(input);
    },
    async close(): Promise<void> {
      await closeResources();
      setPhase('ended');
    },
  };


  function bindChannel(nextChannel: RTCDataChannel): void {
    channel = nextChannel;
    nextChannel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const eventValue = parseCodexOwnerEvent(event.data);
      if (eventValue) emitEvent(eventValue);
    };
  }

  function sendContext(input: {
    target: 'session' | 'delegation';
    channel: 'speakable' | 'commentary';
    content: string;
    providerDelegationId?: string;
  }): void {
    if (channel?.readyState !== 'open') return;
    for (const payload of codexContextAppendPayloads(input)) channel.send(payload);
  }

  function attachRemoteAudio(stream: MediaStream): void {
    if (typeof Audio === 'undefined') return;
    if (!remoteAudio) {
      remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudio.setAttribute('playsinline', 'true');
    }
    remoteAudio.srcObject = stream;
    void remoteAudio.play().catch(() => undefined);
  }

  async function closeResources(): Promise<void> {
    closing = true;
    startAbort?.abort();
    startAbort = null;
    if (remoteAudio) {
      remoteAudio.pause();
      remoteAudio.srcObject = null;
      remoteAudio = null;
    }
    if (channel) {
      channel.onmessage = null;
      channel.close();
      channel = null;
    }
    if (peer) {
      peer.ontrack = null;
      peer.ondatachannel = null;
      peer.onconnectionstatechange = null;
      peer.close();
      peer = null;
    }
    for (const track of localStream?.getTracks() ?? []) track.stop();
    localStream = null;
    muted = false;
    closing = false;
  }

  function fail(code: MobileLivePeerErrorCode): void {
    errorCode = code;
    setPhase('error');
  }
}

function parseCodexOwnerEvent(raw: string): LiveOwnerEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'delegation.created') {
    const item = record.item;
    if (!item || typeof item !== 'object') return null;
    const delegation = item as Record<string, unknown>;
    if (delegation.type !== 'delegation' || delegation.target !== 'client') return null;
    const id = typeof delegation.id === 'string' ? delegation.id.trim() : '';
    if (!id || !Array.isArray(delegation.content)) return null;
    const instruction = delegation.content
      .flatMap((part) => {
        if (!part || typeof part !== 'object') return [];
        const content = part as Record<string, unknown>;
        return content.type === 'input_text' && typeof content.text === 'string'
          ? [content.text]
          : [];
      })
      .join('')
      .trim();
    if (!instruction) return null;
    if (new TextEncoder().encode(instruction).byteLength > LIVE_DELEGATION_INSTRUCTION_MAX_BYTES) {
      return null;
    }
    return { type: 'delegation', providerDelegationId: id, instruction };
  }
  if (record.type === 'input_audio_buffer.speech_started') {
    return { type: 'activity', activity: 'user-speaking' };
  }
  if (
    record.type === 'output_audio_buffer.started' ||
    record.type === 'response.output_audio.delta' ||
    record.type === 'response.audio.delta'
  ) {
    return { type: 'activity', activity: 'assistant-speaking' };
  }
  if (
    record.type === 'input_audio_buffer.speech_stopped' ||
    record.type === 'output_audio_buffer.stopped' ||
    record.type === 'response.done'
  ) {
    return { type: 'activity', activity: 'listening' };
  }
  return null;
}

async function waitForIceGathering(
  peer: Pick<RTCPeerConnection, 'iceGatheringState'> & EventTarget,
  signal: AbortSignal,
): Promise<void> {
  if (peer.iceGatheringState === 'complete') return;
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(resolve), ICE_GATHER_TIMEOUT_MS);
    const onChange = (): void => {
      if (peer.iceGatheringState === 'complete') finish(resolve);
    };
    const onAbort = (): void => finish(() => reject(new DOMException('aborted', 'AbortError')));
    const finish = (done: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', onChange);
      signal.removeEventListener('abort', onAbort);
      done();
    };
    peer.addEventListener('icegatheringstatechange', onChange);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function mapMediaError(error: unknown): MobileLivePeerErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'mic-denied';
    if (error.name === 'NotFoundError' || error.name === 'NotReadableError')
      return 'mic-unavailable';
  }
  if (error instanceof Error && /permission|notallowed/i.test(error.message)) return 'mic-denied';
  return 'peer-failed';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
