/**
 * Pure per-Run idle-loop detector (docs/plans/2026-09-28-run-idle-loop-notice.md).
 *
 * Detection only — nothing here stops or throttles the Run.
 *
 * - Enter: the last RUN_IDLE_LOOP_WINDOW calls contain at most
 *   RUN_IDLE_LOOP_MAX_DISTINCT signatures.
 * - Stay: while looping, every call that repeats a signature already seen in
 *   the Run counts as an idle call.
 * - Recover: the last RUN_IDLE_LOOP_WINDOW calls contain more than
 *   RUN_IDLE_LOOP_MAX_DISTINCT signatures never seen before in the Run.
 *   A single stray call must not flip the state: the 2026-09-28 incident
 *   cycled through 4–5 near-identical `pwd; ls` variants for 100+ steps.
 */

import {
  RUN_IDLE_LOOP_MAX_DISTINCT,
  RUN_IDLE_LOOP_WINDOW,
  type RunIdleLoopCall,
  type RunIdleLoopNotice,
} from '@piwin/contracts';

/** Longest argument preview kept per call; the card shows one line. */
const MAX_PREVIEW_CHARS = 160;

export type IdleLoopCallInput = {
  /** Stable identity of the call (tool + canonical args). */
  signature: string;
  toolName: string;
  /** Display-safe argument preview. */
  preview: string;
};

export type IdleLoopObservation = {
  notice: RunIdleLoopNotice | undefined;
  /** First detection, recovery, or re-entry into a loop. */
  stateChanged: boolean;
  /** The notice changed at all (state or counts). */
  changed: boolean;
};

type WindowEntry = IdleLoopCallInput & { isNew: boolean };
type LoopCallCount = RunIdleLoopCall & { signature: string };

export class RunIdleLoopDetector {
  private readonly window: WindowEntry[] = [];
  private readonly seen = new Set<string>();
  private readonly counts = new Map<string, LoopCallCount>();
  private toolIndex = 0;
  private notice: RunIdleLoopNotice | undefined;

  observe(call: IdleLoopCallInput, now: string): IdleLoopObservation {
    this.toolIndex += 1;
    const isNew = !this.seen.has(call.signature);
    this.seen.add(call.signature);
    this.window.push({ ...call, isNew });
    if (this.window.length > RUN_IDLE_LOOP_WINDOW) this.window.shift();

    if (this.notice?.state === 'looping') {
      const novel = this.window.filter((entry) => entry.isNew).length;
      if (novel > RUN_IDLE_LOOP_MAX_DISTINCT) {
        this.notice = this.withCounts({ state: 'recovered', updatedAt: now });
        return { notice: this.notice, stateChanged: true, changed: true };
      }
      if (isNew) return { notice: this.notice, stateChanged: false, changed: false };
      this.countCall(call);
      this.notice = this.withCounts({ lastToolIndex: this.toolIndex, updatedAt: now });
      return { notice: this.notice, stateChanged: false, changed: true };
    }

    const distinct = new Set(this.window.map((entry) => entry.signature)).size;
    if (this.window.length < RUN_IDLE_LOOP_WINDOW || distinct > RUN_IDLE_LOOP_MAX_DISTINCT) {
      return { notice: this.notice, stateChanged: false, changed: false };
    }
    // Entering (or re-entering) a loop: the whole window counts as idle calls.
    for (const entry of this.window) this.countCall(entry);
    this.notice = this.withCounts({
      state: 'looping',
      firstToolIndex: this.notice?.firstToolIndex ?? this.toolIndex - this.window.length + 1,
      lastToolIndex: this.toolIndex,
      detectedAt: this.notice?.detectedAt ?? now,
      updatedAt: now,
    });
    // Re-entry must not double-count calls already inside the previous episode.
    this.window.length = 0;
    return { notice: this.notice, stateChanged: true, changed: true };
  }

  /** Apply a user dismissal; the notice keeps updating but stays hidden. */
  dismiss(): RunIdleLoopNotice | undefined {
    if (this.notice === undefined) return undefined;
    this.notice = { ...this.notice, dismissed: true };
    return this.notice;
  }

  snapshot(): RunIdleLoopNotice | undefined {
    return this.notice;
  }

  private countCall(call: IdleLoopCallInput): void {
    const existing = this.counts.get(call.signature);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.counts.set(call.signature, {
      signature: call.signature,
      toolName: call.toolName,
      preview: call.preview.slice(0, MAX_PREVIEW_CHARS),
      count: 1,
    });
  }

  private withCounts(patch: Partial<RunIdleLoopNotice>): RunIdleLoopNotice {
    const all = [...this.counts.values()];
    const calls = [...all]
      .sort((left, right) => right.count - left.count)
      .slice(0, RUN_IDLE_LOOP_MAX_DISTINCT)
      .map(({ toolName, preview, count }) => ({ toolName, preview, count }));
    const repeatedCalls = all.reduce((total, entry) => total + entry.count, 0);
    const base: RunIdleLoopNotice = this.notice ?? {
      state: 'looping',
      repeatedCalls: 0,
      calls: [],
      firstToolIndex: this.toolIndex,
      lastToolIndex: this.toolIndex,
      detectedAt: patch.updatedAt ?? '',
      updatedAt: patch.updatedAt ?? '',
    };
    return { ...base, ...patch, repeatedCalls, calls };
  }
}
