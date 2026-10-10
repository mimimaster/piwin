import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestLiveMicrophone } from './live-microphone-request.js';
import { waitForLiveStart } from '../live-start-wait.js';
import { createOpenaiRealtimeDriver } from './openai-realtime-driver.js';
import { createGeminiLiveDriver } from './gemini-live-driver.js';

afterEach(() => vi.useRealTimers());

describe('Live microphone acquisition', () => {
  it('reports an unanswered microphone prompt and releases a late stream', async () => {
    vi.useFakeTimers();
    let approve: (stream: MediaStream) => void = () => undefined;
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const permission = new Promise<MediaStream>((resolve) => { approve = resolve; });
    const preparing = requestLiveMicrophone({ request: () => permission });
    const failed = expect(preparing).rejects.toThrow('mic-permission-timeout');
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    approve(stream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('cancels an unanswered native permission request without waiting for approval', async () => {
    const abort = new AbortController();
    const preparing = waitForLiveStart({ work: new Promise<void>(() => undefined), signal: abort.signal,
      timeoutMs: 30_000, timeoutCode: 'mic-permission-timeout' });
    const failed = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await failed;
  });

  it('preserves a denied permission response', async () => {
    const denied = new DOMException('denied', 'NotAllowedError');
    await expect(requestLiveMicrophone({ request: async () => { throw denied; } })).rejects.toBe(denied);
  });

  it.each(['openai', 'gemini'])('releases a late browser microphone after %s hangup', async (kind) => {
    let approve: (stream: MediaStream) => void = () => undefined;
    const permission = new Promise<MediaStream>((resolve) => { approve = resolve; });
    const stop = vi.fn();
    const deps = { getUserMedia: () => permission };
    const driver = kind === 'openai' ? createOpenaiRealtimeDriver(deps) : createGeminiLiveDriver(deps);
    const preparing = driver.prepareStart();
    const cancelled = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    await driver.close();
    await cancelled;
    approve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
    expect(driver.snapshot().phase).toBe('ended');
  });
});
