import { describe, expect, it, vi } from 'vitest';
import { isManualReclaimInFlight, requestManualReclaim } from './reclaim-wiring.js';
import type { ReclaimCandidate } from './reclaim-policy.js';

const MIB = 1024 * 1024;

function candidate(key: string, bytes = MIB, protectionScore = 0): ReclaimCandidate {
  return {
    kind: 'cache-entries',
    key,
    estimatedBytes: bytes,
    protectionScore,
    lastTouchedMs: 1_000,
    restoreCost: 0.5,
  };
}

describe('requestManualReclaim', () => {
  it('returns no-candidates when nothing is eligible', async () => {
    const result = await requestManualReclaim({
      enumerateCandidates: () => [],
      release: vi.fn(),
    });
    expect(result).toEqual({ releasedBytes: 0, releasedKeys: [], reason: 'no-candidates' });
  });

  it('skips protected candidates and reports no-candidates when only those remain', async () => {
    const release = vi.fn();
    const result = await requestManualReclaim({
      enumerateCandidates: () => [candidate('warm:a', MIB, Number.POSITIVE_INFINITY)],
      release,
    });
    expect(result.reason).toBe('no-candidates');
    expect(release).not.toHaveBeenCalled();
  });

  it('releases eligible candidates least-protected first with a shared deadline', async () => {
    const calls: Array<{ key: string; deadlineMs: number }> = [];
    const result = await requestManualReclaim({
      enumerateCandidates: () => [
        candidate('cache:high', MIB, 10),
        candidate('cache:low', MIB, 0),
        candidate('cache:mid', MIB, 5),
      ],
      release: (key, deadlineMs) => {
        calls.push({ key, deadlineMs });
        return Promise.resolve({ released: MIB });
      },
    });
    expect(calls.map((call) => call.key)).toEqual(['cache:low', 'cache:mid', 'cache:high']);
    expect(new Set(calls.map((call) => call.deadlineMs)).size).toBe(1);
    expect(result.releasedBytes).toBe(3 * MIB);
    expect(result.releasedKeys).toEqual(['cache:low', 'cache:mid', 'cache:high']);
    expect(result.reason).toBeUndefined();
  });

  it('stops the pass on the first release error', async () => {
    const result = await requestManualReclaim({
      enumerateCandidates: () => [candidate('a'), candidate('b')],
      release: (key) =>
        Promise.resolve(
          key === 'a' ? { released: 0, error: 'boom' } : { released: MIB },
        ),
    });
    expect(result.reason).toBe('release-error');
    expect(result.releasedKeys).toEqual([]);
  });

  it('bounds the pass to the slice byte target', async () => {
    const released: string[] = [];
    const result = await requestManualReclaim({
      enumerateCandidates: () => [
        candidate('a', 16 * MIB),
        candidate('b', 16 * MIB),
        candidate('c', MIB),
      ],
      release: (key) => {
        released.push(key);
        return Promise.resolve({ released: MIB });
      },
    });
    expect(released).toEqual(['a']);
    expect(result.releasedKeys).toEqual(['a']);
  });

  it('dedupes a second click while a pass is in flight', async () => {
    let resolveRelease: ((value: { released: number }) => void) | undefined;
    const gate = new Promise<{ released: number }>((resolve) => {
      resolveRelease = resolve;
    });
    const release = vi.fn(() => gate);
    const enumerate = () => [candidate('a')];

    const first = requestManualReclaim({ enumerateCandidates: enumerate, release });
    expect(isManualReclaimInFlight()).toBe(true);
    const second = requestManualReclaim({
      enumerateCandidates: enumerate,
      release: vi.fn(),
    });
    expect(second).toBe(first);

    resolveRelease?.({ released: MIB });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.releasedKeys).toEqual(['a']);
    expect(secondResult).toBe(firstResult);
    expect(release).toHaveBeenCalledTimes(1);
    expect(isManualReclaimInFlight()).toBe(false);
  });
});
