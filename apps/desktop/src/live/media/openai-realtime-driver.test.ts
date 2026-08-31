import { describe, expect, it } from 'vitest';
import { createOpenaiRealtimeDriver } from './openai-realtime-driver.js';
import type { OpenaiRealtimeSocket } from './openai-realtime-driver.js';

function createFakeSocket(): OpenaiRealtimeSocket & {
  emit: (data: string) => void;
  sent: string[];
} {
  const socket: OpenaiRealtimeSocket & { emit: (data: string) => void; sent: string[] } = {
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

describe('createOpenaiRealtimeDriver', () => {
  it('connects and becomes active after session.created', async () => {
    const fake = createFakeSocket();
    const driver = createOpenaiRealtimeDriver({
      connectSocket: async () => fake,
      getUserMedia: async () =>
        ({
          getAudioTracks: () => [],
          getTracks: () => [],
        }) as unknown as MediaStream,
    });
    const events: string[] = [];
    driver.subscribeEvents((event) => events.push(event.type));
    await driver.prepareStart();
    const connectPromise = driver.connect(
      {
        mediaDriverId: 'openai-realtime-ws-v1',
        endpoint: 'wss://example.test/v1/realtime?model=m',
        bearerToken: 'tok',
        inputSampleRateHz: 24_000,
        outputSampleRateHz: 24_000,
        modelId: 'm',
        voice: 'eve',
      },
      new AbortController().signal,
    );
    queueMicrotask(() => {
      fake.emit(JSON.stringify({ type: 'session.created', session: {} }));
    });
    await connectPromise;
    expect(driver.snapshot().phase).toBe('connected');
    expect(events).toContain('media-active');
    expect(fake.sent[0]).toContain('delegate_to_work_session');
    fake.emit(
      JSON.stringify({
        type: 'response.function_call_arguments.done',
        call_id: 'call-1',
        name: 'delegate_to_work_session',
        arguments: '{"instruction":"打开当前项目并总结"}',
      }),
    );
    expect(events).toContain('delegation');
    fake.emit(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'call-2',
      name: 'delegate_to_work_session', arguments: '{"instruction":"不用确认啦"}' }));
    await driver.handleOwnerAction({
      type: 'voice/live-owner-action',
      callId: 'c1',
      action: 'ack-delegation',
      providerDelegationId: 'call-1',
      ok: true,
      queueId: 'q1',
    });
    expect(fake.sent.some((item) => item.includes('function_call_output'))).toBe(true);
    const output = fake.sent.map((frame) => JSON.parse(frame)).find((frame) => frame.item?.type === 'function_call_output');
    expect(output.item.call_id).toBe('call-1');
    expect(fake.sent.some((item) => item.includes('response.create'))).toBe(false);
    await driver.handleOwnerAction({ type: 'voice/live-owner-action', callId: 'c1', action: 'ack-delegation',
      providerDelegationId: 'call-2', ok: false });
    await driver.handleOwnerAction({ type: 'voice/live-owner-action', callId: 'c1', action: 'append-context',
      channel: 'commentary', content: 'Keep this preference in voice. No confirmation.' });
    expect(fake.sent.some((item) => item.includes('response.create'))).toBe(false);
    await driver.handleOwnerAction({ type: 'voice/live-owner-action', callId: 'c1', action: 'append-context',
      channel: 'speakable', content: 'Task result: completed.' });
    expect(fake.sent.filter((item) => item.includes('response.create'))).toHaveLength(1);
    await driver.close();
  });
});
