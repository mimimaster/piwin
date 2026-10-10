import { connectOpenaiRealtimeSocket, type OpenaiRealtimeSocket } from './openai-realtime-socket.js';
import { PendingLiveTools } from '@piwin/voice/wire';
import type {
  LiveClientBootstrapInput,
  LiveOwnerBootstrap,
  LiveOwnerEvent,
} from '@piwin/contracts';
import type { LivePeerSnapshot } from '../live-peer.js';
import type { DesktopLiveMediaDriver } from './live-media-driver.js';
import { floatToPcm16Base64, pcm16Base64ToFloat } from './gemini-live-codec.js';
import { mapLiveMicrophoneError, requestLiveMicrophone } from './live-microphone-request.js';
import {
  openaiRealtimeAudioAppendPayload,
  openaiRealtimeContextAppendPayload,
  openaiRealtimeFunctionOutputPayload,
  openaiRealtimeResponseCreatePayload,
  openaiRealtimeSessionUpdatePayload,
  parseOpenaiRealtimeMessage,
} from './openai-realtime-events.js';

export type { OpenaiRealtimeSocket } from './openai-realtime-socket.js';

export type OpenaiRealtimeDriverDeps = {
  nativeMedia?: {
    prepare(): Promise<void>;
    connect(bootstrap: LiveOwnerBootstrap, callId: string): Promise<OpenaiRealtimeSocket>;
    setMuted(muted: boolean): Promise<void>;
    close(): Promise<void>;
  };
  /** Injected in tests. Production prefers Tauri plugin (Authorization headers). */
  connectSocket?: (input: {
    endpoint: string;
    bearerToken: string;
  }) => Promise<OpenaiRealtimeSocket>;
  getUserMedia?: () => Promise<MediaStream>;
};

export function createOpenaiRealtimeDriver(
  deps: OpenaiRealtimeDriverDeps = {},
): DesktopLiveMediaDriver {
  const snapshotListeners = new Set<(snapshot: LivePeerSnapshot) => void>();
  const eventListeners = new Set<(event: LiveOwnerEvent) => void>();
  let phase: LivePeerSnapshot['phase'] = 'idle';
  let muted = false;
  let errorCode: LivePeerSnapshot['errorCode'] = null;
  let socket: OpenaiRealtimeSocket | null = null;
  let localStream: MediaStream | null = null;
  let captureContext: AudioContext | null = null;
  let playbackContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let nextPlayTime = 0;
  let outputSampleRateHz = 24_000;
  const pendingTools = new PendingLiveTools(() => emitEvent({ type: 'media-failed', mappedCode: 'live-protocol-failed' }));
  let lastAppendedContent = '';
  let microphoneAbort: AbortController | null = null;

  function snapshot(): LivePeerSnapshot {
    return { phase, muted, errorCode };
  }

  function emitSnapshot(): void {
    const next = snapshot();
    for (const listener of snapshotListeners) listener(next);
  }

  function emitEvent(event: LiveOwnerEvent): void {
    for (const listener of eventListeners) listener(event);
  }

  function setPhase(next: LivePeerSnapshot['phase']): void {
    phase = next;
    emitSnapshot();
  }

  function sendJson(payload: string): void {
    if (socket?.readyState === 1) socket.send(payload);
  }

  return {
    id: 'openai-realtime-ws-v1',
    isSupported() {
      return typeof WebSocket === 'function';
    },
    snapshot,
    subscribe(listener) {
      snapshotListeners.add(listener);
      listener(snapshot());
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    async prepareStart(): Promise<LiveClientBootstrapInput> {
      if (phase !== 'idle' && phase !== 'ended' && phase !== 'error') {
        throw new Error('live-protocol-failed');
      }
      setPhase('acquiring-mic');
      const abort = new AbortController();
      microphoneAbort = abort;
      try {
        if (deps.nativeMedia) await deps.nativeMedia.prepare();
        else localStream = await requestLiveMicrophone({ signal: abort.signal,
          ...(deps.getUserMedia ? { request: deps.getUserMedia } : {}) });
      } catch (error: unknown) {
        if (abort.signal.aborted) throw error;
        errorCode = mapLiveMicrophoneError(error);
        setPhase('error');
        throw new Error(errorCode);
      }
      setPhase('negotiating');
      return { mediaDriverId: 'openai-realtime-ws-v1' };
    },
    async connect(bootstrap: LiveOwnerBootstrap, signal: AbortSignal, callId?: string): Promise<void> {
      if (bootstrap.mediaDriverId !== 'openai-realtime-ws-v1') {
        throw new Error('live-media-unsupported');
      }
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      outputSampleRateHz = bootstrap.outputSampleRateHz;
      if (deps.nativeMedia && !callId) throw new Error('live-protocol-failed');
      const next = deps.nativeMedia && callId ? await deps.nativeMedia.connect(bootstrap, callId) : await (deps.connectSocket ?? connectOpenaiRealtimeSocket)({
        endpoint: bootstrap.endpoint,
        bearerToken: bootstrap.bearerToken,
      });
      if (signal.aborted) { next.close(); throw new DOMException('aborted', 'AbortError'); }
      socket = next;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const setupTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          next.close();
          reject(new Error('live-protocol-failed'));
        }, 10_000);
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(setupTimer);
          signal.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve();
        };
        const onAbort = (): void => {
          next.close();
          finish(new DOMException('aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        next.onerror = () => {
          finish(new Error('live-protocol-failed'));
        };
        next.onclose = (event) => {
          if (phase === 'connected') {
            emitEvent({ type: 'media-closed' });
            return;
          }
          finish(
            new Error(
              event?.reason?.trim() ? 'live-provider-rejected' : 'live-protocol-failed',
            ),
          );
        };
        next.onmessage = (event) => {
          if (typeof event.data !== 'string') return;
          const parsed = parseOpenaiRealtimeMessage(event.data);
          if (parsed.kind === 'session-created' || parsed.kind === 'session-updated') {
            // Native capture starts only after the server accepts our format.
            if (deps.nativeMedia && parsed.kind === 'session-created') return;
            if (phase !== 'connected') {
              setPhase('connected');
              emitEvent({ type: 'media-active' });
              try {
                startCapture(bootstrap.inputSampleRateHz);
              } catch {
                // Tests may omit AudioContext.
              }
              finish();
            }
            return;
          }
          if (parsed.kind === 'owner') emitEvent(parsed.event);
          if (parsed.kind === 'tool-call') {
            if (!pendingTools.add(parsed.id)) return;
            emitEvent({
              type: 'delegation',
              providerDelegationId: parsed.id,
              instruction: parsed.instruction,
            });
          }
          if (parsed.kind === 'audio-delta') playPcm16Base64(parsed.base64);
          if (parsed.kind === 'error') {
            if (phase === 'connected') emitEvent({ type: 'media-failed', mappedCode: 'live-provider-rejected' });
            finish(new Error('live-provider-rejected'));
          }
        };
        const kickoff = (): void => {
          sendJson(
            openaiRealtimeSessionUpdatePayload({
              voice: bootstrap.voice,
              ...(bootstrap.startupContext
                ? { startupContext: bootstrap.startupContext }
                : {}),
            }),
          );
        };
        if (next.readyState === 1) {
          kickoff();
        } else {
          next.onopen = kickoff;
        }
      });
    },
    async setMuted(nextMuted) {
      await deps.nativeMedia?.setMuted(nextMuted);
      muted = nextMuted;
      if (localStream) {
        for (const track of localStream.getAudioTracks()) track.enabled = !nextMuted;
      }
      emitSnapshot();
    },
    async handleOwnerAction(action) {
      if (action.action === 'release-media') {
        await this.close();
        return;
      }
      if (action.action === 'ack-delegation') {
        const toolId = pendingTools.take(action.providerDelegationId);
        if (!toolId) return;
        sendJson(
          openaiRealtimeFunctionOutputPayload({
            callId: toolId,
            accepted: action.ok === true,
            queued: Boolean(action.queueId),
          }),
        );
        // Admission is not a request to speak. Host supplies a separate
        // commentary or speakable result after the decision.
        return;
      }
      if (action.action === 'append-context' && action.content) {
        this.appendContext({
          target: action.target === 'delegation' ? 'delegation' : 'session',
          channel: action.channel === 'commentary' ? 'commentary' : 'speakable',
          content: action.content,
        });
      }
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    appendContext(input) {
      const content = input.content.trim();
      if (!content || content === lastAppendedContent) return;
      lastAppendedContent = content;
      sendJson(openaiRealtimeContextAppendPayload(content));
      if (input.channel === 'speakable') sendJson(openaiRealtimeResponseCreatePayload());
    },
    async close() {
      microphoneAbort?.abort();
      microphoneAbort = null;
      await deps.nativeMedia?.close();
      processor?.disconnect();
      processor = null;
      if (captureContext) {
        await captureContext.close().catch(() => undefined);
        captureContext = null;
      }
      if (playbackContext) {
        await playbackContext.close().catch(() => undefined);
        playbackContext = null;
      }
      nextPlayTime = 0;
      if (localStream) {
        const tracks = typeof localStream.getTracks === 'function' ? localStream.getTracks() : [];
        for (const track of tracks) track.stop();
        localStream = null;
      }
      socket?.close();
      socket = null;
      pendingTools.clear();
      lastAppendedContent = '';
      setPhase('ended');
    },
  };

  function startCapture(sampleRateHz: number): void {
    if (!localStream || typeof AudioContext === 'undefined') return;
    const context = new AudioContext({ sampleRate: sampleRateHz });
    captureContext = context;
    const source = context.createMediaStreamSource(localStream);
    const node = context.createScriptProcessor(2048, 1, 1);
    processor = node;
    node.onaudioprocess = (event) => {
      if (muted) return;
      const samples = event.inputBuffer.getChannelData(0);
      sendJson(openaiRealtimeAudioAppendPayload(floatToPcm16Base64(samples)));
    };
    source.connect(node);
    node.connect(context.destination);
  }

  function playPcm16Base64(base64: string): void {
    if (typeof AudioContext === 'undefined') return;
    try {
      const samples = pcm16Base64ToFloat(base64);
      if (samples.length === 0) return;
      const context = playbackContext ?? new AudioContext({ sampleRate: outputSampleRateHz });
      playbackContext = context;
      const buffer = context.createBuffer(1, samples.length, outputSampleRateHz);
      const channel = new Float32Array(samples.length);
      channel.set(samples);
      buffer.copyToChannel(channel, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startAt = Math.max(context.currentTime, nextPlayTime);
      source.start(startAt);
      nextPlayTime = startAt + buffer.duration;
    } catch {
      // Playback is best-effort; keep the call alive.
    }
  }
}
