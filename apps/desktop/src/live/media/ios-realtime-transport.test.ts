// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createNativeLiveAudioBridge, type NativeLiveAudioEvent } from '@piwin/host-client';
import { createIosRealtimeTransport } from './ios-realtime-transport.js';
import { createOpenaiRealtimeDriver } from './openai-realtime-driver.js';
import type { LiveOwnerBootstrap } from '@piwin/contracts';

const bootstrap: LiveOwnerBootstrap = {
  mediaDriverId: 'openai-realtime-ws-v1', endpoint: 'wss://example.test/realtime', bearerToken: 'test-only',
  inputSampleRateHz: 24000, outputSampleRateHz: 24000, modelId: 'grok-voice-latest', voice: 'eve',
};

function fixture(prepare?: () => Promise<void>) {
  let notice = () => {};
  let events: NativeLiveAudioEvent[] = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (command.endsWith('prepare')) await prepare?.();
    if (command.endsWith('take_events')) { const previous = events; events = []; return previous; }
    if (command.endsWith('connect')) {
      const connection = args?.connection as { connectionId: string };
      events.push({ connectionId: connection.connectionId, type: 'message', message: '{"type":"session.created"}' });
      notice();
    }
    return { ok: true };
  });
  const unregister = vi.fn(async () => {});
  const media = createIosRealtimeTransport({ bridge: createNativeLiveAudioBridge(invoke),
    listen: async (callback) => { notice = callback; return unregister; } });
  const driver = createOpenaiRealtimeDriver({ nativeMedia: media });
  function emit(message: string, id?: string) {
    const connection = invoke.mock.calls.find(([command]) => command.endsWith('connect'))?.[1]?.connection as { connectionId: string };
    events.push({ connectionId: id ?? connection.connectionId, type: 'message', message }); notice();
  }
  return { driver, media, invoke, unregister, emit };
}

describe('iOS native realtime transport', () => {
  it('waits for accepted PCM settings, forwards Host tools, and releases native media', async () => {
    const test = fixture();
    const owner = vi.fn(); test.driver.subscribeEvents(owner);
    await test.driver.prepareStart();
    const connecting = test.driver.connect(bootstrap, new AbortController().signal, 'host-call');
    await vi.waitFor(() => expect(test.invoke.mock.calls.some(([command]) => command.endsWith('connect'))).toBe(true));
    expect(test.driver.snapshot().phase).toBe('negotiating');
    test.emit('{"type":"session.updated"}'); await connecting;
    expect(test.driver.snapshot().phase).toBe('connected');
    const input = test.invoke.mock.calls.find(([command]) => command.endsWith('connect'))?.[1]?.connection;
    expect(input).toMatchObject({ callId: 'host-call', readyEventTypes: ['session.updated'] });
    test.emit(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'delegate_to_work_session',
      call_id: 'tool-id', arguments: '{"instruction":"总结项目"}' }));
    await vi.waitFor(() => expect(owner).toHaveBeenCalledWith({ type: 'delegation', providerDelegationId: 'tool-id', instruction: '总结项目' }));
    await test.driver.setMuted(true);
    expect(test.driver.snapshot().muted).toBe(true);
    await test.driver.close();
    expect(test.unregister).toHaveBeenCalledOnce();
    expect(test.invoke.mock.calls.some(([command]) => command.endsWith('close'))).toBe(true);
  });

  it('a late microphone approval cannot start a closed call', async () => {
    let resolve = () => {};
    const permission = new Promise<void>((done) => { resolve = done; });
    const test = fixture(() => permission);
    const preparing = test.media.prepare();
    const rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    await test.media.close(); resolve(); await rejected;
    expect(test.invoke.mock.calls.some(([command]) => command.endsWith('connect'))).toBe(false);
  });

  it('reports a missing native event-channel permission as unsupported media', async () => {
    const invoke = vi.fn(async (): Promise<unknown> => ({ ok: true }));
    const media = createIosRealtimeTransport({ bridge: createNativeLiveAudioBridge(invoke),
      listen: async () => { throw 'register_listener not allowed by ACL'; } });
    await media.prepare();
    await expect(media.connect(bootstrap, 'host-call')).rejects.toThrow('live-media-unsupported');
    await media.close();
  });

  it('times out a silent native microphone request and closes its preparation', async () => {
    vi.useFakeTimers();
    try {
      const test = fixture(() => new Promise<void>(() => undefined));
      const preparing = test.media.prepare();
      const failed = expect(preparing).rejects.toThrow('mic-permission-timeout');
      await vi.advanceTimersByTimeAsync(30_000);
      await failed;
      await test.media.close();
      expect(test.invoke.mock.calls.some(([command]) => command.endsWith('close'))).toBe(true);
      expect(test.invoke.mock.calls.some(([command]) => command.endsWith('connect'))).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('ignores another connection and propagates native failure', async () => {
    const test = fixture(); const owner = vi.fn(); test.driver.subscribeEvents(owner);
    await test.driver.prepareStart();
    const connecting = test.driver.connect(bootstrap, new AbortController().signal, 'host-call');
    await vi.waitFor(() => expect(test.invoke.mock.calls.some(([command]) => command.endsWith('connect'))).toBe(true));
    test.emit('{"type":"session.updated"}', 'old-connection');
    await Promise.resolve(); expect(test.driver.snapshot().phase).toBe('negotiating');
    test.emit('{"type":"session.updated"}'); await connecting;
    test.emit('{"type":"error","error":{"message":"test failure"}}');
    await vi.waitFor(() => expect(owner).toHaveBeenCalledWith({ type: 'media-failed', mappedCode: 'live-provider-rejected' }));
    await test.driver.close();
  });
});
