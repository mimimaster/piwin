import { createNativeLiveAudioBridge } from '@piwin/host-client';
import type { LiveOwnerBootstrap } from '@piwin/contracts';
import { openaiRealtimeAudioAppendPayload } from '@piwin/voice/wire';
import type { OpenaiRealtimeDriverDeps, OpenaiRealtimeSocket } from './openai-realtime-driver.js';
import { waitForLiveStart } from '../live-start-wait.js';

type NativeBridge = ReturnType<typeof createNativeLiveAudioBridge>;
export type IosRealtimeTransportDeps = {
  bridge: NativeBridge;
  listen: (notice: () => void) => Promise<() => Promise<void>>;
};

/** PCM and the authenticated socket remain native when WebKit is suspended. */
export function createIosRealtimeTransport(injected?: IosRealtimeTransportDeps): NonNullable<OpenaiRealtimeDriverDeps['nativeMedia']> {
  let connectionId: string | null = null;
  let socket: OpenaiRealtimeSocket | null = null;
  let release: (() => Promise<void>) | null = null;
  let drainChain = Promise.resolve();
  let native: IosRealtimeTransportDeps | null = injected ?? null;
  let removeResume: (() => void) | null = null;
  let prepareAbort: AbortController | null = null;

  async function dependencies(): Promise<IosRealtimeTransportDeps> {
    if (native) return native;
    const { invoke, addPluginListener } = await import('@tauri-apps/api/core');
    native = {
      bridge: createNativeLiveAudioBridge(invoke),
      listen: async (notice) => {
        const listener = await addPluginListener('piwin-live', 'audio', notice);
        return () => listener.unregister();
      },
    };
    return native;
  }

  function failed(current: OpenaiRealtimeSocket): void {
    current.onerror?.();
    current.onclose?.({ reason: 'native-media-failed' });
  }

  return {
    async prepare() {
      if (connectionId) throw new Error('live-protocol-failed');
      const currentId = crypto.randomUUID();
      connectionId = currentId;
      const abort = new AbortController();
      prepareAbort = abort;
      const { bridge } = await dependencies();
      await waitForLiveStart({ work: bridge.prepare(currentId), signal: abort.signal,
        timeoutMs: 30_000, timeoutCode: 'mic-permission-timeout' });
      // A microphone permission prompt may resolve after the user ends Live.
      if (connectionId !== currentId) throw new DOMException('aborted', 'AbortError');
    },
    async connect(bootstrap: LiveOwnerBootstrap, callId: string) {
      if (bootstrap.mediaDriverId !== 'openai-realtime-ws-v1' || !connectionId) throw new Error('live-media-unsupported');
      const currentId = connectionId;
      const { bridge, listen } = await dependencies();
      let started = false;
      let outgoing = Promise.resolve();
      const current: OpenaiRealtimeSocket = {
        readyState: 1, onopen: null, onmessage: null, onerror: null, onclose: null,
        send(message) {
          outgoing = outgoing.then(async () => {
            if (connectionId !== currentId) return;
            if (started) { await bridge.send(currentId, message); return; }
            started = true;
            await bridge.connect({
              connectionId: currentId, callId, endpoint: bootstrap.endpoint, bearerToken: bootstrap.bearerToken,
              initialMessage: message, inputFrameTemplate: openaiRealtimeAudioAppendPayload('__PIWIN_PCM__'),
              inputSampleRateHz: bootstrap.inputSampleRateHz, outputSampleRateHz: bootstrap.outputSampleRateHz,
              readyEventTypes: ['session.updated'],
              audioEventTypes: ['response.output_audio.delta', 'response.audio.delta'],
              interruptEventTypes: ['input_audio_buffer.speech_started'],
              failureEventTypes: ['error'],
              forwardEventTypes: ['session.created', 'session.updated', 'error', 'input_audio_buffer.speech_started',
                'input_audio_buffer.speech_stopped', 'response.created', 'response.done',
                'response.function_call_arguments.done', 'response.output_item.done'],
              activityByEventType: {
                'input_audio_buffer.speech_started': 'user-speaking',
                'input_audio_buffer.speech_stopped': 'listening', 'response.done': 'listening',
                'response.created': 'assistant-speaking',
              },
            });
          }).catch(() => failed(current));
        },
        close() {
          current.readyState = 3;
          void bridge.close(currentId).catch(() => failed(current));
        },
      };
      socket = current;
      const drain = async (): Promise<void> => {
        if (connectionId !== currentId || current.readyState !== 1) return;
        for (const event of await bridge.takeEvents(currentId)) {
          if (connectionId !== currentId || current.readyState !== 1) return;
          if (event.type === 'failed') failed(current);
          else if (event.message) current.onmessage?.({ data: event.message });
        }
      };
      const notice = (): void => { drainChain = drainChain.then(drain).catch(() => failed(current)); };
      const unregister = await listen(notice);
      if (connectionId !== currentId) { await unregister(); throw new DOMException('aborted', 'AbortError'); }
      release = unregister;
      const resume = (): void => { if (document.visibilityState === 'visible') notice(); };
      document.addEventListener('visibilitychange', resume);
      removeResume = () => document.removeEventListener('visibilitychange', resume);
      notice();
      return current;
    },
    async setMuted(muted) {
      if (connectionId) await (await dependencies()).bridge.setMuted(connectionId, muted);
    },
    async close() {
      prepareAbort?.abort(); prepareAbort = null;
      const previous = connectionId;
      connectionId = null;
      if (socket) { socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.readyState = 3; }
      socket = null;
      removeResume?.(); removeResume = null;
      const unregister = release; release = null;
      if (unregister) await unregister();
      if (previous) await (await dependencies()).bridge.close(previous);
    },
  };
}
