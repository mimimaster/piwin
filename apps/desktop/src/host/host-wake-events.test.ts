// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { attachHostWakeEvents, retryHostConnectionNow } from './host-wake-events';

describe('host wake events', () => {
  it('wakes the link when the network comes back', () => {
    const wake = vi.fn(() => true);
    const detach = attachHostWakeEvents({
      getClient: () => ({ wake, getState: () => ({ kind: 'ready' }) }),
      redial: vi.fn(),
    });
    window.dispatchEvent(new Event('online'));
    expect(wake).toHaveBeenCalledTimes(1);

    detach();
    window.dispatchEvent(new Event('online'));
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('redials on a manual retry when the transport has nothing to wake', () => {
    const redial = vi.fn();
    const detach = attachHostWakeEvents({
      getClient: () => ({ wake: () => false, getState: () => ({ kind: 'disconnected' }) }),
      redial,
    });
    retryHostConnectionNow();
    expect(redial).toHaveBeenCalledTimes(1);
    detach();

    // Nothing is attached any more; a stray retry must not reach the old link.
    retryHostConnectionNow();
    expect(redial).toHaveBeenCalledTimes(1);
  });
});
