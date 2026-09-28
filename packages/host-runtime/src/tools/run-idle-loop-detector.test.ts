import { describe, expect, it } from 'vitest';
import { RunIdleLoopDetector, type IdleLoopCallInput } from './run-idle-loop-detector.js';

const NOW = '2026-09-28T13:12:00.000Z';

function call(signature: string): IdleLoopCallInput {
  return { signature, toolName: signature.split(':')[0] ?? 'tool', preview: signature };
}

function feed(detector: RunIdleLoopDetector, signatures: readonly string[]) {
  return signatures.map((signature) => detector.observe(call(signature), NOW));
}

// Tool calls of generation 07891336 in session-mul8xazj-igkvj1zu (2026-09-28):
// the Kiro provider sent an empty context every step and the model kept
// probing the workspace. Aliases are the distinct tool+args signatures.
const INCIDENT = (
  'c0 c0 c1 c2 c0 c3 c3 c0 c1 c0 c3 c3 c4 c1 c3 c3 c0 c1 c1 c0 c3 c3 c1 c0 c1 c0 c5 c0 c4 c6 ' +
  'c4 c1 c1 c1 c4 c3 c0 c3 c1 c3 c1 c4 c1 c3 c4 c1 c3 c3 c3 c1 c4 c3 c4 c1 c1 c4 c0 c1 c3 c1 c0'
).split(' ');

describe('RunIdleLoopDetector', () => {
  it('stays silent on a productive run with varied calls', () => {
    const detector = new RunIdleLoopDetector();
    const results = feed(
      detector,
      Array.from({ length: 40 }, (_, index) => `edit:file-${index % 9}:change-${index}`),
    );
    expect(results.every((result) => !result.changed)).toBe(true);
    expect(detector.snapshot()).toBeUndefined();
  });

  it('flags a window of 12 calls with at most 3 signatures', () => {
    const detector = new RunIdleLoopDetector();
    const results = feed(detector, ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c']);
    expect(results.slice(0, 11).every((result) => !result.changed)).toBe(true);
    expect(results[11]).toMatchObject({ stateChanged: true, changed: true });
    expect(detector.snapshot()).toMatchObject({
      state: 'looping',
      repeatedCalls: 12,
      firstToolIndex: 1,
      lastToolIndex: 12,
    });
  });

  it('detects the real 2026-09-28 incident and keeps counting it', () => {
    const detector = new RunIdleLoopDetector();
    const results = feed(detector, INCIDENT);
    const firstDetection = results.findIndex((result) => result.stateChanged);
    expect(firstDetection + 1).toBe(25);
    const notice = detector.snapshot();
    expect(notice?.state).toBe('looping');
    // The detecting window (12) plus every later call that repeats a known
    // signature: 36 calls after #25, minus the first-seen c5 and c6.
    expect(notice?.repeatedCalls).toBe(12 + 36 - 2);
    expect(notice?.calls).toHaveLength(3);
    expect(notice?.calls[0]?.count).toBeGreaterThanOrEqual(notice?.calls[2]?.count ?? 0);
  });

  it('does not recover on one stray call, recovers on sustained new work', () => {
    const detector = new RunIdleLoopDetector();
    feed(detector, Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? 'a' : 'b')));
    feed(detector, ['stray', 'a', 'b', 'w1', 'w2']);
    // Three first-seen calls in the window are not enough to call it recovered.
    expect(detector.snapshot()).toMatchObject({ state: 'looping', repeatedCalls: 14 });
    const [recovery] = feed(detector, ['w3']);
    expect(recovery).toMatchObject({ stateChanged: true });
    expect(detector.snapshot()).toMatchObject({ state: 'recovered', repeatedCalls: 14 });
  });

  it('re-enters the same notice and keeps the first detection point', () => {
    const detector = new RunIdleLoopDetector();
    feed(detector, Array.from({ length: 12 }, () => 'a'));
    feed(detector, ['w1', 'w2', 'w3', 'w4']);
    const detectedAt = detector.snapshot()?.detectedAt;
    const reentry = feed(detector, Array.from({ length: 12 }, () => 'b'));
    // Re-entry at the 10th `b` (window w3 w4 b×10), then two more repeats.
    expect(reentry.findIndex((result) => result.stateChanged)).toBe(9);
    expect(detector.snapshot()).toMatchObject({
      state: 'looping',
      firstToolIndex: 1,
      repeatedCalls: 12 + 12 + 2,
      detectedAt,
    });
  });

  it('keeps a dismissal while counts keep updating', () => {
    const detector = new RunIdleLoopDetector();
    feed(detector, Array.from({ length: 12 }, () => 'a'));
    expect(detector.dismiss()?.dismissed).toBe(true);
    feed(detector, ['a', 'a']);
    expect(detector.snapshot()).toMatchObject({ dismissed: true, repeatedCalls: 14 });
  });
});
