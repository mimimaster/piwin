import { PendingLiveTools } from '@piwin/voice/wire';
import type {
  LiveClientBootstrapInput,
  LiveOwnerBootstrap,
  LiveOwnerEvent,
} from '@piwin/contracts';
import type { LivePeerSnapshot } from '../live-peer.js';
import type { DesktopLiveMediaDriver } from './live-media-driver.js';
import { floatToPcm16Base64, pcm16Base64ToFloat } from './gemini-live-codec.js';
import {
  openaiRealtimeAudioAppendPayload,
  openaiRealtimeContextAppendPayload,
  openaiRealtimeFunctionOutputPayload,
  openaiRealtimeResponseCreatePayload,
  openaiRealtimeSessionUpdatePayload,
  parseOpenaiRealtimeMessage,
} from './openai-realtime-events.js';

export type OpenaiRealtimeSocket = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null;
};

export type OpenaiRealtimeDriverDeps = {
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
        errorCode = 'mic-denied';
        setPhase('error');
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          throw new Error('mic-denied');
        }
        throw new Error('mic-unavailable');
      }
      setPhase('negotiating');
      return { mediaDriverId: 'openai-realtime-ws-v1' };
    },
    async connect(bootstrap: LiveOwnerBootstrap, signal: AbortSignal): Promise<void> {
      if (bootstrap.mediaDriverId !== 'openai-realtime-ws-v1') {
        throw new Error('live-media-unsupported');
      }
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      outputSampleRateHz = bootstrap.outputSampleRateHz;
      const next = await (deps.connectSocket ?? connectOpenaiRealtimeSocket)({
        endpoint: bootstrap.endpoint,
        bearerToken: bootstrap.bearerToken,
      });
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
            finish(new Error('live-provider-rejected'));
          }
        };
        const kickoff = (): void => {
          sendJson(
            openaiRealtimeSessionUpdatePayload({
              voice: bootstrap.voice,
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
    setMuted(nextMuted) {
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

async function connectOpenaiRealtimeSocket(input: {
  endpoint: string;
  bearerToken: string;
}): Promise<OpenaiRealtimeSocket> {
  try {
    const { default: PluginWebSocket } = await import('@tauri-apps/plugin-websocket');
    const plugin = await PluginWebSocket.connect(input.endpoint, {
      headers: { Authorization: `Bearer ${input.bearerToken}` },
    });
    return wrapTauriPluginSocket(plugin);
  } catch {
    // Node / unit tests may inject connectSocket. Browser WebSocket cannot set
    // Authorization; fail closed rather than leaking a key into the query string.
    throw new Error('live-media-unsupported');
  }
}

function wrapTauriPluginSocket(plugin: {
  addListener: (listener: (message: {
    type: string;
    data?: unknown;
  }) => void) => () => void;
  send: (message: string) => Promise<void>;
  disconnect: () => Promise<void>;
}): OpenaiRealtimeSocket {
  let readyState = 0;
  const socket: OpenaiRealtimeSocket = {
    readyState,
    send(data) {
      void plugin.send(data);
    },
    close() {
      readyState = 2;
      socket.readyState = 2;
      void plugin.disconnect().finally(() => {
        readyState = 3;
        socket.readyState = 3;
        socket.onclose?.({ code: 1000, reason: '' });
      });
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
  plugin.addListener((message) => {
    if (message.type === 'Text' && typeof message.data === 'string') {
      socket.onmessage?.({ data: message.data });
      return;
    }
    if (message.type === 'Close') {
      readyState = 3;
      socket.readyState = 3;
      const data = message.data as { code?: number; reason?: string } | null | undefined;
      socket.onclose?.({ code: data?.code ?? 1000, reason: data?.reason ?? '' });
    }
  });
  // Plugin connect() resolves only after the handshake succeeds.
  readyState = 1;
  socket.readyState = 1;
  return socket;
}
