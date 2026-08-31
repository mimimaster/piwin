import { describe, expect, it } from 'vitest';
import { waitForLiveMediaReady } from './live-media-readiness.js';

describe('Live media readiness', () => {
  it('waits for actual readiness and unsubscribes', async () => {
    let state: 'pending' | 'ready' = 'pending';
    const listeners = new Set<() => void>();
    let ready = false;
    const work = waitForLiveMediaReady({
      read: () => state, signal: new AbortController().signal,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    }).then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    state = 'ready';
    for (const listener of listeners) listener();
    await work;
    expect(listeners.size).toBe(0);
  });

  it('rejects failed media, timeout, and abort without leaking subscriptions', async () => {
    for (const mode of ['failed', 'timeout', 'abort'] as const) {
      const abort = new AbortController();
      let subscribed = false;
      const work = waitForLiveMediaReady({
        read: () => mode === 'failed' ? 'failed' : 'pending', signal: abort.signal, timeoutMs: 5,
        subscribe: () => { subscribed = true; return () => { subscribed = false; }; },
      });
      if (mode === 'abort') abort.abort();
      await expect(work).rejects.toMatchObject({ name: mode === 'abort' ? 'AbortError' : 'Error' });
      expect(subscribed).toBe(false);
    }
  });

  it('honors an already-aborted signal even for ready media', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(waitForLiveMediaReady({ read: () => 'ready', signal: abort.signal,
      subscribe: () => () => undefined,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
