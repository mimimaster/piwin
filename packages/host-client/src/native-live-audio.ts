import type { LiveActivityInvoke } from './live-activity-bridge.js';

/** Owner-only, process-memory materials; never copy this into a system card. */
export type NativeLiveAudioConnect = {
  connectionId: string;
  callId: string;
  endpoint: string;
  bearerToken: string;
  initialMessage: string;
  inputFrameTemplate: string;
  inputSampleRateHz: number;
  outputSampleRateHz: number;
  readyEventTypes: string[];
  audioEventTypes: string[];
  interruptEventTypes: string[];
  forwardEventTypes: string[];
  activityByEventType: Record<string, string>;
  failureEventTypes: string[];
};

export type NativeLiveAudioEvent = {
  connectionId: string;
  type: 'message' | 'failed';
  message?: string;
};

export function createNativeLiveAudioBridge(invoke: LiveActivityInvoke) {
  return {
    async prepare(connectionId: string): Promise<void> {
      try { await invoke('plugin:piwin-live|live_audio_prepare', { connectionId }); }
      catch (error: unknown) {
        const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null &&
          'message' in error && typeof error.message === 'string' ? error.message : String(error);
        if (message === 'mic-denied') throw new DOMException('mic-denied', 'NotAllowedError');
        throw new Error(message === 'live-start-cancelled' ? 'live-start-cancelled' : 'mic-unavailable');
      }
    },
    async connect(connection: NativeLiveAudioConnect): Promise<void> {
      await invoke('plugin:piwin-live|live_audio_connect', { connection });
    },
    async send(connectionId: string, message: string): Promise<void> {
      await invoke('plugin:piwin-live|live_audio_send', { connectionId, message });
    },
    async setMuted(connectionId: string, muted: boolean): Promise<void> {
      await invoke('plugin:piwin-live|live_audio_set_muted', { connectionId, muted });
    },
    async close(connectionId: string): Promise<void> {
      await invoke('plugin:piwin-live|live_audio_close', { connectionId });
    },
    async takeEvents(connectionId: string): Promise<NativeLiveAudioEvent[]> {
      const result = await invoke('plugin:piwin-live|live_audio_take_events', { connectionId });
      if (!Array.isArray(result)) return [];
      return result.flatMap((value: unknown): NativeLiveAudioEvent[] => {
        if (!value || typeof value !== 'object') return [];
        const event = value as Record<string, unknown>;
        if (event.connectionId !== connectionId || (event.type !== 'message' && event.type !== 'failed')) return [];
        return [{ connectionId, type: event.type, ...(typeof event.message === 'string' ? { message: event.message } : {}) }];
      });
    },
  };
}
