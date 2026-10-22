import { describe, expect, it } from 'vitest';
import {
  createInFlightCommandTracker,
  formatInFlightCommands,
  nextLongRunningReportAge,
} from './host-serve-inflight-commands.js';

describe('in-flight command tracker', () => {
  it('reports at fixed ages, then every 30 minutes', () => {
    expect(nextLongRunningReportAge(0)).toBe(30_000);
    expect(nextLongRunningReportAge(30_000)).toBe(120_000);
    expect(nextLongRunningReportAge(700_000)).toBe(1_800_000);
    expect(nextLongRunningReportAge(1_800_500)).toBe(3_600_500);
  });

  it('logs a still-running handler once per threshold and forgets it when it ends', () => {
    let clockMs = 0;
    const lines: string[] = [];
    const tracker = createInFlightCommandTracker({ now: () => clockMs, log: (line) => lines.push(line) });
    const entry = tracker.begin('session/compact', 'serialized');

    clockMs = 29_999;
    expect(tracker.reportLongRunning()).toBe(0);
    clockMs = 31_000;
    expect(tracker.reportLongRunning()).toBe(1);
    expect(tracker.reportLongRunning()).toBe(0);
    entry.timedOut = true;
    clockMs = 125_000;
    expect(tracker.reportLongRunning()).toBe(1);
    expect(lines[1]).toContain('session/compact lane=serialized age=125000ms (client already got timeout)');

    tracker.end(entry);
    clockMs = 10_000_000;
    expect(tracker.reportLongRunning()).toBe(0);
    expect(tracker.snapshot()).toEqual([]);
  });

  it('formats the oldest handler first', () => {
    expect(formatInFlightCommands([])).toBe('none');
    expect(
      formatInFlightCommands([
        { type: 'project/list', lane: 'concurrent', ageMs: 10, timedOut: false },
        { type: 'session/compact', lane: 'serialized', ageMs: 90_000, timedOut: true },
      ]),
    ).toBe(
      'session/compact(lane=serialized age=90000ms timed-out), project/list(lane=concurrent age=10ms)',
    );
  });
});
