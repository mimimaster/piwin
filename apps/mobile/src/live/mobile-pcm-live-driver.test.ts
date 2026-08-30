// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { GEMINI_LIVE_FIXED_ENDPOINT } from './live-wire.js';
import { createMobilePcmLiveDriver } from './mobile-pcm-live-driver.js';
import type { MobileLiveSocket } from './mobile-live-media-driver.js';

function fakeMediaStream(): MediaStream {
  return {
    getTracks: () => [],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

class FakeBrowserSocket {
  static instances: FakeBrowserSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeBrowserSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '' });
  }

  emit(data: string): void {
    this.onmessage?.({ data });
  }
}

function fakeOpenSocket(): MobileLiveSocket & { sent: string[]; emit: (data: string) => void } {
  const socket: MobileLiveSocket & { sent: string[]; emit: (data: string) => void } = {
    readyState: 1,
    sent: [],
    send(data) {
      this.sent.push(data);
    },
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000, reason: '' });
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    emit(data) {
      this.onmessage?.({ data });
    },
  };
  return socket;
}

describe('mobile PCM Live drivers', () => {
  it('connects Gemini through the constrained endpoint and acknowledges delegation', async () => {
    FakeBrowserSocket.instances = [];
    const driver = createMobilePcmLiveDriver('gemini-live-v1beta', {
      WebSocketImpl: FakeBrowserSocket as unknown as typeof WebSocket,
      getUserMedia: async () => fakeMediaStream(),
    });
    const events: string[] = [];
    driver.subscribeEvents((event) => events.push(event.type));
    await driver.prepareStart();
    const connecting = driver.connect(
      {
        mediaDriverId: 'gemini-live-v1beta',
        endpoint: GEMINI_LIVE_FIXED_ENDPOINT,
        ephemeralToken: 'auth_tokens/abc',
        inputSampleRateHz: 16_000,
        outputSampleRateHz: 24_000,
        modelId: 'gemini-live-preview',
        voice: 'Kore',
        thinkingLevel: 'minimal',
      },
      new AbortController().signal,
    );
    await Promise.resolve();
    const socket = FakeBrowserSocket.instances[0];
    expect(socket?.url).toContain('access_token=');
    expect(socket?.url).not.toContain('AIza');
    socket?.emit(JSON.stringify({ setupComplete: {} }));
    await connecting;
    expect(driver.snapshot().phase).toBe('connected');
    expect(events).toContain('media-active');
    socket?.emit(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            { id: 'fn-1', name: 'delegate_to_work_session', args: { instruction: '检查移动端' } },
          ],
        },
      }),
    );
    expect(events).toContain('delegation');
    await driver.handleOwnerAction({
      type: 'voice/live-owner-action',
      callId: 'call-1',
      action: 'ack-delegation',
      providerDelegationId: 'fn-1',
      ok: true,
      queueId: 'queue-1',
    });
    expect(socket?.sent.some((payload) => payload.includes('toolResponse'))).toBe(true);
    await driver.close();
  });

  it('uses an injected OpenAI socket without exposing the bearer token to the browser URL', async () => {
    const socket = fakeOpenSocket();
    const driver = createMobilePcmLiveDriver('openai-realtime-ws-v1', {
      connectSocket: async () => socket,
      getUserMedia: async () => fakeMediaStream(),
    });
    await driver.prepareStart();
    const connecting = driver.connect(
      {
        mediaDriverId: 'openai-realtime-ws-v1',
        endpoint: 'wss://example.test/v1/realtime?model=mobile',
        bearerToken: 'secret-token',
        inputSampleRateHz: 24_000,
        outputSampleRateHz: 24_000,
        modelId: 'mobile',
        voice: 'eve',
      },
      new AbortController().signal,
    );
    await Promise.resolve();
    socket.emit(JSON.stringify({ type: 'session.created', session: {} }));
    await connecting;
    expect(socket.sent[0]).toContain('session.update');
    expect(socket.sent[0]).not.toContain('secret-token');
    await driver.close();
  });
});
