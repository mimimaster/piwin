import type { HostCommand } from '@piwin/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBrowserLeaseCommand,
  browserMirrorLeaseKey,
  createDisconnectedMirrorLeaseReaper,
} from './browser-mirror-leases.js';

describe('applyBrowserLeaseCommand', () => {
  it('tracks named and legacy leases through start and stop', () => {
    const held = new Set<string>();
    applyBrowserLeaseCommand(held, { type: 'browser/start', leaseId: 'lease-a' });
    applyBrowserLeaseCommand(held, { type: 'browser/start' });
    expect(held).toEqual(new Set([browserMirrorLeaseKey(undefined, 'lease-a'), browserMirrorLeaseKey()]));

    applyBrowserLeaseCommand(held, { type: 'browser/stop', leaseId: 'lease-a' });
    applyBrowserLeaseCommand(held, { type: 'browser/stop' });
    expect(held.size).toBe(0);
  });

  it('keeps identically named leases in different conversations separate', () => {
    const held = new Set<string>();
    applyBrowserLeaseCommand(held, { type: 'browser/start', leaseId: 'same', sessionId: 'a' });
    applyBrowserLeaseCommand(held, { type: 'browser/start', leaseId: 'same', sessionId: 'b' });
    applyBrowserLeaseCommand(held, { type: 'browser/stop', leaseId: 'same', sessionId: 'a' });
    expect(held).toEqual(new Set([browserMirrorLeaseKey('b', 'same')]));
  });
});

describe('createDisconnectedMirrorLeaseReaper', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(liveLeases: Set<string>) {
    vi.useFakeTimers();
    const execute = vi.fn(async (_command: HostCommand) => ({ success: true }));
    const onError = vi.fn();
    const reaper = createDisconnectedMirrorLeaseReaper({
      isHeldByLiveConnection: (lease) => liveLeases.has(lease),
      execute,
      onError,
      graceMs: 1_000,
    });
    return { reaper, execute, onError };
  }

  it('releases an orphaned lease after the grace period without retiring it', async () => {
    const { reaper, execute } = setup(new Set());
    reaper.schedule([browserMirrorLeaseKey(undefined, 'lease-a'), browserMirrorLeaseKey()]);

    await vi.advanceTimersByTimeAsync(999);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledWith({ type: 'browser/stop', leaseId: 'lease-a', reason: 'disconnect' });
    expect(execute).toHaveBeenCalledWith({ type: 'browser/stop', reason: 'disconnect' });
  });

  it('keeps a lease a reconnected client holds again', async () => {
    const live = new Set<string>();
    const { reaper, execute } = setup(live);
    reaper.schedule([browserMirrorLeaseKey(undefined, 'lease-a')]);
    live.add(browserMirrorLeaseKey(undefined, 'lease-a'));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(execute).not.toHaveBeenCalled();
  });

  it('releases the disconnected conversation without touching a different conversation lease', async () => {
    const { reaper, execute } = setup(new Set([browserMirrorLeaseKey('b', 'same')]));
    reaper.schedule([browserMirrorLeaseKey('a', 'same')]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      type: 'browser/stop', sessionId: 'a', leaseId: 'same', reason: 'disconnect',
    });
  });

  it('reports a failed release and cancels pending ones on dispose', async () => {
    const { reaper, execute, onError } = setup(new Set());
    execute.mockResolvedValueOnce({ success: false, error: 'boom' } as { success: boolean });
    reaper.schedule([browserMirrorLeaseKey(undefined, 'lease-a')]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledTimes(1);

    reaper.schedule([browserMirrorLeaseKey(undefined, 'lease-b')]);
    reaper.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
