import type {
  LiveClientBootstrapInput,
  LiveOwnerActionPush,
  LiveOwnerBootstrap,
  LiveOwnerEvent,
} from '@piwin/contracts';
import { isNativeTauriRuntime } from '../mobile-device-credential-vault.js';
import {
  floatToPcm16Base64,
  geminiAudioPayload,
  geminiContextAppendPayload,
  geminiSetupPayload,
  geminiToolResponsePayload,
  mapGeminiWsClose,
  openaiAudioAppendPayload,
  openaiFunctionOutputPayload,
  openaiSessionUpdatePayload,
  parseGeminiLiveMessage,
  parseOpenaiRealtimeMessage,
  pcm16Base64ToFloat,
  realtimeContextAppendPayload,
  realtimeResponseCreatePayload,
} from './live-wire.js';
import { connectGeminiSocket, connectOpenaiSocket } from './mobile-pcm-sockets.js';
import type {
  MobileLiveMediaDriver,
  MobileLivePeerSnapshot,
  MobileLiveSocket,
} from './mobile-live-media-driver.js';

export type MobilePcmDriverKind = 'gemini-live-v1beta' | 'openai-realtime-ws-v1';

export type MobilePcmLiveDriverDeps = {
  WebSocketImpl?: typeof WebSocket;
  connectSocket?: (input: { endpoint: string; bearerToken: string }) => Promise<MobileLiveSocket>;
  getUserMedia?: () => Promise<MediaStream>;
};

export function createMobilePcmLiveDriver(
  kind: MobilePcmDriverKind,
  deps: MobilePcmLiveDriverDeps = {},
): MobileLiveMediaDriver {
  const snapshotListeners = new Set<(snapshot: MobileLivePeerSnapshot) => void>();
  const eventListeners = new Set<(event: LiveOwnerEvent) => void>();
  let phase: MobileLivePeerSnapshot['phase'] = 'idle';
  let muted = false;
  let errorCode: MobileLivePeerSnapshot['errorCode'] = null;
  let socket: MobileLiveSocket | null = null;
  let localStream: MediaStream | null = null;
  let captureContext: AudioContext | null = null;
  let playbackContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let nextPlayTime = 0;
  let outputSampleRateHz = 24_000;
  let pendingToolId: string | null = null;
  let lastAppendedContent = '';

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

  function setPhase(next: MobileLivePeerSnapshot['phase']): void {
    phase = next;
    emitSnapshot();
  }

  function sendJson(payload: string): void {
    if (socket?.readyState === 1) socket.send(payload);
  }

  return {
    id: kind,
    isSupported() {
      if (kind === 'gemini-live-v1beta') {
        return deps.WebSocketImpl !== undefined || typeof WebSocket === 'function';
      }
      return deps.connectSocket !== undefined || isNativeTauriRuntime();
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
      setPhase('acquiring-mic');
      const getUserMedia =
        deps.getUserMedia ??
        (() => {
          if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('mic-unavailable');
          }
          return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        });
      try {
        localStream = await getUserMedia();
      } catch (error: unknown) {
        errorCode =
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'mic-denied'
            : 'mic-unavailable';
        setPhase('error');
        throw new Error(errorCode);
      }
      setPhase('negotiating');
      return { mediaDriverId: kind };
    },
    async connect(bootstrap: LiveOwnerBootstrap, signal: AbortSignal): Promise<void> {
      if (bootstrap.mediaDriverId !== kind) throw new Error('live-media-unsupported');
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const inputSampleRateHz = bootstrap.inputSampleRateHz;
      outputSampleRateHz = bootstrap.outputSampleRateHz;
      const next =
        kind === 'gemini-live-v1beta'
          ? await connectGeminiSocket(
              bootstrap.mediaDriverId === 'gemini-live-v1beta' ? bootstrap.endpoint : '',
              bootstrap.mediaDriverId === 'gemini-live-v1beta' ? bootstrap.ephemeralToken : '',
              deps,
            )
          : await (deps.connectSocket ?? connectOpenaiSocket)({
              endpoint:
                bootstrap.mediaDriverId === 'openai-realtime-ws-v1' ? bootstrap.endpoint : '',
              bearerToken:
                bootstrap.mediaDriverId === 'openai-realtime-ws-v1' ? bootstrap.bearerToken : '',
            });
      socket = next;
      await waitForProviderReady(next, bootstrap, inputSampleRateHz, signal);
    },
    setMuted(nextMuted) {
      muted = nextMuted;
      if (localStream) {
        for (const track of localStream.getAudioTracks()) track.enabled = !nextMuted;
      }
      emitSnapshot();
    },
    async handleOwnerAction(action: LiveOwnerActionPush): Promise<void> {
      if (action.action === 'release-media') {
        await this.close();
        return;
      }
      if (action.action === 'ack-delegation' && pendingToolId) {
        const accepted = action.ok === true;
        if (kind === 'gemini-live-v1beta') {
          sendJson(
            geminiToolResponsePayload({
              id: pendingToolId,
              accepted,
              queued: Boolean(action.queueId),
            }),
          );
        } else {
          sendJson(
            openaiFunctionOutputPayload({
              callId: pendingToolId,
              accepted,
              queued: Boolean(action.queueId),
            }),
          );
          sendJson(realtimeResponseCreatePayload());
        }
        pendingToolId = null;
        return;
      }
      if (action.action === 'append-context' && action.content) {
        sendContext(action.content);
      }
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    appendContext(input) {
      const content = input.content.trim();
      if (!content || content === lastAppendedContent) return;
      lastAppendedContent = content;
      sendContext(content);
      if (kind === 'openai-realtime-ws-v1') sendJson(realtimeResponseCreatePayload());
    },
    async close(): Promise<void> {
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
        for (const track of localStream.getTracks()) track.stop();
        localStream = null;
      }
      socket?.close();
      socket = null;
      pendingToolId = null;
      setPhase('ended');
    },
  };

  async function waitForProviderReady(
    next: MobileLiveSocket,
    bootstrap: LiveOwnerBootstrap,
    inputSampleRateHz: number,
    signal: AbortSignal,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const setupTimeoutMs = kind === 'gemini-live-v1beta' ? 8_000 : 10_000;
      const setupTimer = setTimeout(
        () => finish(new Error('live-protocol-failed')),
        setupTimeoutMs,
      );
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
      next.onerror = () => finish(new Error('live-protocol-failed'));
      next.onclose = (event) => {
        const mapped =
          kind === 'gemini-live-v1beta'
            ? mapGeminiWsClose(event?.code ?? 1006, event?.reason ?? '')
            : 'live-provider-rejected';
        if (phase === 'connected') {
          emitEvent(
            mapped === 'live-disconnected'
              ? { type: 'media-closed' }
              : { type: 'media-failed', mappedCode: 'live-provider-rejected' },
          );
          return;
        }
        finish(new Error(mapped));
      };
      next.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        if (kind === 'gemini-live-v1beta') {
          const parsed = parseGeminiLiveMessage(event.data);
          if (!parsed) return;
          if (parsed.kind === 'setup-complete') {
            setPhase('connected');
            emitEvent({ type: 'media-active' });
            startCapture(inputSampleRateHz);
            finish();
          } else if (parsed.kind === 'owner') {
            emitEvent(parsed.event);
          } else if (parsed.kind === 'tool-call') {
            pendingToolId = parsed.id;
            emitEvent({
              type: 'delegation',
              providerDelegationId: parsed.id,
              instruction: parsed.instruction,
            });
          } else if (parsed.kind === 'audio') {
            playPcm16Base64(parsed.pcmBase64);
          } else if (parsed.kind === 'go-away') {
            emitEvent({ type: 'media-closed' });
          }
          return;
        }
        const parsed = parseOpenaiRealtimeMessage(event.data);
        if (parsed.kind === 'session-created' || parsed.kind === 'session-updated') {
          if (phase !== 'connected') {
            setPhase('connected');
            emitEvent({ type: 'media-active' });
            startCapture(inputSampleRateHz);
            finish();
          }
          return;
        }
        if (parsed.kind === 'owner') emitEvent(parsed.event);
        if (parsed.kind === 'tool-call') {
          pendingToolId = parsed.id;
          emitEvent({
            type: 'delegation',
            providerDelegationId: parsed.id,
            instruction: parsed.instruction,
          });
        }
        if (parsed.kind === 'audio-delta') playPcm16Base64(parsed.base64);
        if (parsed.kind === 'error') finish(new Error('live-provider-rejected'));
      };
      if (next.readyState === 1) {
        sendJson(
          kind === 'gemini-live-v1beta'
            ? geminiSetupPayload()
            : openaiSessionUpdatePayload(
                bootstrap.mediaDriverId === 'openai-realtime-ws-v1' ? bootstrap.voice : 'eve',
              ),
        );
      } else {
        next.onopen = () => {
          sendJson(
            kind === 'gemini-live-v1beta'
              ? geminiSetupPayload()
              : openaiSessionUpdatePayload(
                  bootstrap.mediaDriverId === 'openai-realtime-ws-v1' ? bootstrap.voice : 'eve',
                ),
          );
        };
      }
    });
  }

  function startCapture(sampleRateHz: number): void {
    if (!localStream || typeof AudioContext === 'undefined') return;
    const context = new AudioContext({ sampleRate: sampleRateHz });
    captureContext = context;
    void context.resume().catch(() => undefined);
    const source = context.createMediaStreamSource(localStream);
    const node = context.createScriptProcessor(2048, 1, 1);
    const silence = context.createGain();
    silence.gain.value = 0;
    processor = node;
    node.onaudioprocess = (event) => {
      if (muted) return;
      const samples = event.inputBuffer.getChannelData(0);
      sendJson(
        kind === 'gemini-live-v1beta'
          ? geminiAudioPayload(floatToPcm16Base64(samples))
          : openaiAudioAppendPayload(floatToPcm16Base64(samples)),
      );
    };
    source.connect(node);
    node.connect(silence);
    silence.connect(context.destination);
  }

  function playPcm16Base64(base64: string): void {
    if (typeof AudioContext === 'undefined') return;
    try {
      const samples = pcm16Base64ToFloat(base64);
      if (samples.length === 0) return;
      const context = playbackContext ?? new AudioContext({ sampleRate: outputSampleRateHz });
      playbackContext = context;
      void context.resume().catch(() => undefined);
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
      // Audio playback is best-effort; a provider call must not die on a device audio glitch.
    }
  }

  function sendContext(content: string): void {
    sendJson(
      kind === 'gemini-live-v1beta'
        ? geminiContextAppendPayload(content)
        : realtimeContextAppendPayload(content),
    );
  }
}
