import { afterEach, describe, expect, it, vi } from 'vitest';
import { TuiTurnClock } from './tui-turn-clock.js';

describe('TuiTurnClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('anchors elapsedMs to an authoritative startedAt across session switches', () => {
    vi.useFakeTimers();
    const startedAt = 1_000_000;
    vi.setSystemTime(startedAt + 14_000);

    const clock = new TuiTurnClock();
    const ticks = vi.fn();
    clock.startTurn(ticks, startedAt);
    expect(clock.turnStartedAt).toBe(startedAt);
    expect(clock.elapsedMs()).toBe(14_000);

    // Switching away stops the turn timer; switching back re-anchors to startedAt.
    clock.stopTurn();
    expect(clock.turnStartedAt).toBeUndefined();

    vi.advanceTimersByTime(6_000);
    clock.startTurn(ticks, startedAt);
    expect(clock.elapsedMs()).toBe(20_000);

    vi.advanceTimersByTime(2_000);
    expect(ticks).toHaveBeenCalledTimes(2);
    expect(clock.elapsedMs()).toBe(22_000);
    clock.dispose();
  });

  it('defaults to Date.now() when startedAt is omitted and clamps negative skew', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);

    const clock = new TuiTurnClock();
    clock.startTurn(() => undefined);
    expect(clock.turnStartedAt).toBe(5_000_000);
    expect(clock.elapsedMs()).toBe(0);

    clock.startTurn(() => undefined, 5_005_000);
    expect(clock.elapsedMs()).toBe(0);
    clock.dispose();
  });
});
