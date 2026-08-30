import type {
  LiveClientBootstrapInput,
  LiveOwnerBootstrap,
  LiveOwnerEvent,
} from '@piwin/contracts';
import type { LivePeerSnapshot } from '../live-peer.js';
import type { DesktopLiveMediaDriver } from './live-media-driver.js';
import {
  geminiAudioPayload,
  geminiContextAppendPayload,
  geminiSetupPayload,
  geminiToolResponsePayload,
  mapGeminiWsClose,
  parseGeminiLiveMessage,
} from './gemini-live-events.js';
import { floatToPcm16Base64 } from './gemini-live-codec.js';

export const GEMINI_LIVE_FIXED_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

export type GeminiLiveDriverDeps = {
  WebSocketImpl?: typeof WebSocket;
  getUserMedia?: () => Promise<MediaStream>;
};

export function createGeminiLiveDriver(deps: GeminiLiveDriverDeps = {}): DesktopLiveMediaDriver {
  const snapshotListeners = new Set<(snapshot: LivePeerSnapshot) => void>();
  const eventListeners = new Set<(event: LiveOwnerEvent) => void>();
  let phase: LivePeerSnapshot['phase'] = 'idle';
  let muted = false;
  let errorCode: LivePeerSnapshot['errorCode'] = null;
  let socket: WebSocket | null = null;
  let localStream: MediaStream | null = null;
  let pendingToolId: string | null = null;
  let captureContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;

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
    id: 'gemini-live-v1beta',
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
      return { mediaDriverId: 'gemini-live-v1beta' };
    },
    async connect(bootstrap: LiveOwnerBootstrap, signal: AbortSignal): Promise<void> {
      if (bootstrap.mediaDriverId !== 'gemini-live-v1beta') {
        throw new Error('live-media-unsupported');
      }
      if (bootstrap.endpoint !== GEMINI_LIVE_FIXED_ENDPOINT) {
        throw new Error('live-protocol-failed');
      }
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const Socket = deps.WebSocketImpl ?? WebSocket;
      const url = `${bootstrap.endpoint}?access_token=${encodeURIComponent(bootstrap.ephemeralToken)}`;
      await new Promise<void>((resolve, reject) => {
        const next = new Socket(url);
        socket = next;
        let settled = false;
        const setupTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          next.close();
          reject(new Error('live-protocol-failed'));
        }, 8_000);
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
        next.onopen = () => {
          next.send(geminiSetupPayload());
        };
        next.onerror = () => {
          finish(new Error('live-protocol-failed'));
        };
        next.onclose = (event: { code?: number; reason?: string }) => {
          const mapped = mapGeminiWsClose(event.code ?? 1006, event.reason ?? '');
          console.error(`[piwin-live] gemini ws close code=${event.code ?? 1006} ${mapped}`);
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
          const parsed = parseGeminiLiveMessage(event.data);
          if (!parsed) return;
          if (parsed.kind === 'setup-complete') {
            setPhase('connected');
            emitEvent({ type: 'media-active' });
            try {
              startCapture();
            } catch {
              // Capture is optional in tests without a full AudioContext graph.
            }
            finish();
            return;
          }
          if (parsed.kind === 'owner') emitEvent(parsed.event);
          if (parsed.kind === 'go-away') emitEvent({ type: 'media-closed' });
          if (parsed.kind === 'tool-call') {
            pendingToolId = parsed.id;
            emitEvent({
              type: 'delegation',
              providerDelegationId: parsed.id,
              instruction: parsed.instruction,
            });
          }
        };
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
      if (action.action === 'ack-delegation' && pendingToolId) {
        sendJson(
          geminiToolResponsePayload({
            id: pendingToolId,
            accepted: action.ok === true,
            queued: Boolean(action.queueId),
          }),
        );
        pendingToolId = null;
        return;
      }
      if (action.action === 'append-context' && action.content) {
        sendJson(geminiContextAppendPayload(action.content));
      }
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    appendContext(input) {
      sendJson(geminiContextAppendPayload(input.content));
    },
    async close() {
      processor?.disconnect();
      processor = null;
      if (captureContext) {
        await captureContext.close().catch(() => undefined);
        captureContext = null;
      }
      if (localStream) {
        const tracks = typeof localStream.getTracks === 'function' ? localStream.getTracks() : [];
        for (const track of tracks) track.stop();
        localStream = null;
      }
      socket?.close();
      socket = null;
      setPhase('ended');
    },
  };

  function startCapture(): void {
    if (!localStream || typeof AudioContext === 'undefined') return;
    const context = new AudioContext({ sampleRate: 16_000 });
    captureContext = context;
    const source = context.createMediaStreamSource(localStream);
    const node = context.createScriptProcessor(2048, 1, 1);
    processor = node;
    node.onaudioprocess = (event) => {
      if (muted) return;
      const samples = event.inputBuffer.getChannelData(0);
      sendJson(geminiAudioPayload(floatToPcm16Base64(samples)));
    };
    source.connect(node);
    node.connect(context.destination);
  }
}
