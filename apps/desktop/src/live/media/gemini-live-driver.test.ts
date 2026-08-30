// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  parseGeminiLiveMessage,
  geminiSetupPayload,
  geminiToolResponsePayload,
  mapGeminiWsClose,
} from './gemini-live-events.js';
import { createGeminiLiveDriver, GEMINI_LIVE_FIXED_ENDPOINT } from './gemini-live-driver.js';
import { DesktopLiveMediaDriverRegistry } from './live-media-driver-registry.js';
import { floatToPcm16Base64, pcm16Base64ToFloat } from './gemini-live-codec.js';

function fakeMediaStream(): MediaStream {
  return {
    getTracks: () => [],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeWith(1000, '');
  }

  closeWith(code: number, reason: string): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  emit(data: string): void {
    this.onmessage?.({ data });
  }
}

describe('Gemini Live desktop driver', () => {
  it('rejects a non-fixed endpoint and never logs the token', async () => {
    const driver = createGeminiLiveDriver({
      getUserMedia: async () => fakeMediaStream(),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    await driver.prepareStart();
    await expect(
      driver.connect(
        {
          mediaDriverId: 'gemini-live-v1beta',
          endpoint: 'wss://example.test/not-constrained',
          ephemeralToken: 'secret-token',
          inputSampleRateHz: 16_000,
          outputSampleRateHz: 24_000,
          modelId: 'gemini-3.1-flash-live-preview',
          voice: 'Kore',
          thinkingLevel: 'minimal',
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('live-protocol-failed');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('acks a function call without waiting for the work run', async () => {
    FakeSocket.instances = [];
    const events: string[] = [];
    const driver = createGeminiLiveDriver({
      getUserMedia: async () => fakeMediaStream(),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    driver.subscribeEvents((event) => events.push(event.type));
    await driver.prepareStart();
    const connecting = driver.connect(
      {
        mediaDriverId: 'gemini-live-v1beta',
        endpoint: GEMINI_LIVE_FIXED_ENDPOINT,
        ephemeralToken: 'auth_tokens/abc',
        inputSampleRateHz: 16_000,
        outputSampleRateHz: 24_000,
        modelId: 'gemini-3.1-flash-live-preview',
        voice: 'Kore',
        thinkingLevel: 'low',
      },
      new AbortController().signal,
    );
    await Promise.resolve();
    const socket = FakeSocket.instances[0];
    expect(socket?.url).toContain('access_token=');
    expect(socket?.url).not.toMatch(/AIza|sk-/);
    expect(socket?.sent[0]).toBe(geminiSetupPayload());
    socket?.emit(JSON.stringify({ setupComplete: {} }));
    await connecting;
    socket?.emit(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'fn-1',
              name: 'delegate_to_work_session',
              args: { instruction: 'summarize the session' },
            },
          ],
        },
      }),
    );
    expect(events).toContain('delegation');
    await driver.handleOwnerAction({
      type: 'voice/live-owner-action',
      callId: 'c1',
      action: 'ack-delegation',
      providerDelegationId: 'fn-1',
      ok: true,
      queueId: 'q1',
    });
    const ack = socket?.sent.find((item) => item.includes('toolResponse'));
    expect(ack).toContain('queued');
    expect(JSON.parse(geminiToolResponsePayload({ id: 'fn-1', accepted: true, queued: true }))).toEqual(
      JSON.parse(ack ?? '{}'),
    );
    await driver.close();
  });

  it('maps a credits-depleted close before setup completes', async () => {
    FakeSocket.instances = [];
    const driver = createGeminiLiveDriver({
      getUserMedia: async () => fakeMediaStream(),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    await driver.prepareStart();
    const connecting = driver.connect(
      {
        mediaDriverId: 'gemini-live-v1beta',
        endpoint: GEMINI_LIVE_FIXED_ENDPOINT,
        ephemeralToken: 'auth_tokens/abc',
        inputSampleRateHz: 16_000,
        outputSampleRateHz: 24_000,
        modelId: 'gemini-3.1-flash-live-preview',
        voice: 'Kore',
        thinkingLevel: 'minimal',
      },
      new AbortController().signal,
    );
    await Promise.resolve();
    FakeSocket.instances[0]?.closeWith(
      1011,
      'Your prepayment credits are depleted. Please go to AI Studio',
    );
    await expect(connecting).rejects.toThrow('live-gemini-credits');
    expect(mapGeminiWsClose(1011, 'Your prepayment credits are depleted.')).toBe(
      'live-gemini-credits',
    );
  });

  it('parses audio and go-away without leaking payloads into owner events', () => {
    const audio = parseGeminiLiveMessage(
      JSON.stringify({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AAAA' } }] },
        },
      }),
    );
    expect(audio).toEqual({ kind: 'audio', pcmBase64: 'AAAA' });
    expect(parseGeminiLiveMessage(JSON.stringify({ goAway: { timeLeft: '2s' } }))).toEqual({
      kind: 'go-away',
    });
    const samples = pcm16Base64ToFloat(floatToPcm16Base64(new Float32Array([0, 0.5, -0.5])));
    expect(samples.length).toBe(3);
  });

  it('rejects duplicate driver ids at registry construction', () => {
    expect(
      () =>
        new DesktopLiveMediaDriverRegistry([
          ['gemini-live-v1beta', () => createGeminiLiveDriver()],
          ['gemini-live-v1beta', () => createGeminiLiveDriver()],
        ]),
    ).toThrow(/duplicate Live media driver/);
  });
});
