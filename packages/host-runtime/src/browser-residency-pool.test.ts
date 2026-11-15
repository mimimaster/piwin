import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSession } from '@piwin/browser';
import { BrowserResidencyPool } from './browser-residency-pool.js';

afterEach(() => vi.useRealTimers());

function session(lastUsedAtMs: number, eligible = true) {
  let resident = true;
  const suspendIdle = vi.fn(async () => { resident = false; return { suspended: true }; });
  const value = { residencySnapshot: () => ({ resident, lastUsedAtMs, eligible: resident && eligible }),
    suspendIdle } as unknown as BrowserSession;
  return { value, suspendIdle };
}

describe('Host browser idle pool', () => {
  it('keeps at most the two newest eligible idle runtimes while leaving protected ones alone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const oldest = session(100); const newer = session(200); const newest = session(300);
    const protectedSession = session(0, false);
    const pool = new BrowserResidencyPool({ sessions: () => [oldest, newer, newest, protectedSession].map(({ value }) => Promise.resolve(value)), onError: vi.fn() });
    await pool.sweep();
    expect(oldest.suspendIdle).toHaveBeenCalledOnce();
    expect(newer.suspendIdle).not.toHaveBeenCalled();
    expect(newest.suspendIdle).not.toHaveBeenCalled();
    expect(protectedSession.suspendIdle).not.toHaveBeenCalled();
    await pool.dispose();
  });
  it('expires even a single eligible idle runtime after the TTL', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const idle = session(0);
    const pool = new BrowserResidencyPool({ sessions: () => [Promise.resolve(idle.value)], onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(idle.suspendIdle).toHaveBeenCalledOnce();
    await pool.dispose();
  });
  it('does not let one failed browser block the remaining candidates', async () => {
    const broken = session(0); const healthy = session(0);
    broken.suspendIdle.mockRejectedValueOnce(new Error('cleanup failed'));
    const onError = vi.fn();
    const pool = new BrowserResidencyPool({ sessions: () => [Promise.resolve(broken.value), Promise.resolve(healthy.value)], onError });
    await pool.sweep();
    expect(onError).toHaveBeenCalledOnce();
    expect(healthy.suspendIdle).toHaveBeenCalledOnce();
    await pool.dispose();
  });
  it('stops scheduling after Host disposal', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const idle = session(0);
    const pool = new BrowserResidencyPool({ sessions: () => [Promise.resolve(idle.value)], onError: vi.fn() });
    await pool.dispose();
    await vi.advanceTimersByTimeAsync(600_000);
    await pool.sweep();
    expect(idle.suspendIdle).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
