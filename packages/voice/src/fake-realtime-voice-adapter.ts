/**
 * Deterministic fake adapter for Host/Desktop walking skeleton tests.
 */

import type { LiveCallErrorCode } from '@piwin/contracts';
import type {
  CreateRealtimeCallInput,
  CreateRealtimeCallResult,
  RealtimeVoiceAdapter,
  RealtimeVoiceAdapterEvent,
  VoiceDelegationEvent,
} from './realtime-voice-adapter.js';

export type FakeRealtimeVoiceAdapterControls = {
  failCreateWith?: LiveCallErrorCode;
  autoReady?: boolean;
  /** Hold createCall until this settles so tests can hang up mid-start. */
  holdCreate?: Promise<void>;
};

export class FakeRealtimeVoiceAdapter implements RealtimeVoiceAdapter {
  private readonly listeners = new Set<(event: RealtimeVoiceAdapterEvent) => void>();
  private closed = false;
  private readonly controls: FakeRealtimeVoiceAdapterControls;

  constructor(controls: FakeRealtimeVoiceAdapterControls = {}) {
    this.controls = controls;
  }

  async createCall(input: CreateRealtimeCallInput): Promise<CreateRealtimeCallResult> {
    if (this.closed) throw new Error('adapter closed');
    if (input.signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (this.controls.holdCreate) {
      await waitForHoldOrAbort(this.controls.holdCreate, input.signal);
    }
    if (input.signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (this.controls.failCreateWith) {
      const code = this.controls.failCreateWith;
      this.emit({ type: 'failed', errorCode: code });
      throw new Error(code);
    }
    if (!input.sdpOffer.trim().startsWith('v=')) {
      throw new Error('live-protocol-failed');
    }
    if (this.controls.autoReady !== false) {
      queueMicrotask(() => {
        if (!this.closed) this.emit({ type: 'ready' });
      });
    }
    return {
      sdpAnswer: 'v=0\no=- fake 1 IN IP4 127.0.0.1\ns=-\nt=0 0\n',
    };
  }

  subscribe(listener: (event: RealtimeVoiceAdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitDelegation(delegation: VoiceDelegationEvent): void {
    this.emit({ type: 'delegation', delegation });
  }

  emitActivity(activity: 'listening' | 'user-speaking' | 'assistant-speaking'): void {
    this.emit({ type: 'activity', activity });
  }

  emitFailed(errorCode: LiveCallErrorCode): void {
    this.emit({ type: 'failed', errorCode });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.emit({ type: 'closed' });
    this.listeners.clear();
  }

  private emit(event: RealtimeVoiceAdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function waitForHoldOrAbort(hold: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      hold.catch(() => undefined);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void hold.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
