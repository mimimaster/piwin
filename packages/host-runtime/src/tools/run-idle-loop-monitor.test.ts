import { describe, expect, it } from 'vitest';
import type { RunIdleLoopNotice } from '@piwin/contracts';
import { RunIdleLoopMonitor } from './run-idle-loop-monitor.js';

function harness() {
  let clock = 1_000_000;
  const published: RunIdleLoopNotice[] = [];
  const timers: Array<{ at: number; run: () => void; cleared: boolean }> = [];
  const monitor = new RunIdleLoopMonitor({
    publish: (_runId, notice) => published.push(notice),
    now: () => clock,
    setTimer: (run, delayMs) => {
      const timer = { at: clock + delayMs, run, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  });
  return {
    monitor,
    published,
    bash: (command: string) => monitor.observeTool('run-1', { toolName: 'bash', command }),
    advance: (ms: number) => {
      clock += ms;
      for (const timer of timers) {
        if (!timer.cleared && timer.at <= clock) {
          timer.cleared = true;
          timer.run();
        }
      }
    },
  };
}

describe('RunIdleLoopMonitor', () => {
  it('publishes detection at once and throttles count-only refreshes', () => {
    const h = harness();
    for (let index = 0; index < 12; index += 1) h.bash('pwd; ls');
    expect(h.published).toHaveLength(1);
    expect(h.published[0]).toMatchObject({ state: 'looping', repeatedCalls: 12 });

    h.advance(500);
    h.bash('pwd; ls');
    h.bash('pwd; ls');
    expect(h.published).toHaveLength(1);

    h.advance(2_500);
    // Trailing flush lands the latest count once the refresh window passes.
    expect(h.published).toHaveLength(2);
    expect(h.published[1]?.repeatedCalls).toBe(14);
  });

  it('publishes a dismissal immediately and keeps it', () => {
    const h = harness();
    for (let index = 0; index < 12; index += 1) h.bash('pwd; ls');
    expect(h.monitor.dismiss('run-1')).toBe(true);
    expect(h.published.at(-1)?.dismissed).toBe(true);
    expect(h.monitor.dismiss('missing')).toBe(false);
  });

  it('exposes unpublished counts to the terminal snapshot and releases timers', () => {
    const h = harness();
    for (let index = 0; index < 13; index += 1) h.bash('pwd; ls');
    expect(h.published.at(-1)?.repeatedCalls).toBe(12);
    expect(h.monitor.snapshot('run-1')?.repeatedCalls).toBe(13);
    h.monitor.release('run-1');
    h.advance(10_000);
    expect(h.published).toHaveLength(1);
    expect(h.monitor.snapshot('run-1')).toBeUndefined();
  });
});
