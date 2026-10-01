/**
 * Host-side idle-loop monitor: one detector per Run plus publish throttling
 * (docs/plans/2026-09-28-run-idle-loop-notice.md).
 *
 * State changes (first detection, recovery, re-entry) publish at once.
 * Count-only changes publish at most every RUN_IDLE_LOOP_REFRESH_MS, with a
 * trailing flush so the last count still lands. Detection only: this never
 * aborts, pauses, or throttles the Run.
 */

import { RUN_IDLE_LOOP_REFRESH_MS, type RunIdleLoopNotice } from '@piwin/contracts';
import {
  RunIdleLoopDetector,
  type IdleLoopObservation,
  type IdleLoopTextInput,
} from './run-idle-loop-detector.js';
import { fingerprintToolLoopCall, type ToolLoopObservation } from './tool-loop-progress.js';

export type RunIdleLoopMonitorOptions = {
  publish: (runId: string, notice: RunIdleLoopNotice) => void;
  refreshMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

type RunEntry = {
  detector: RunIdleLoopDetector;
  lastPublishedAt: number;
  timer: unknown;
};

export class RunIdleLoopMonitor {
  private readonly runs = new Map<string, RunEntry>();
  private readonly refreshMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly options: RunIdleLoopMonitorOptions) {
    this.refreshMs = options.refreshMs ?? RUN_IDLE_LOOP_REFRESH_MS;
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        // A pending refresh must never keep the Host process alive.
        timer.unref?.();
        return timer;
      });
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  observeTool(runId: string, observation: ToolLoopObservation): void {
    const entry = this.getOrCreate(runId);
    const result = entry.detector.observe(
      {
        signature: fingerprintToolLoopCall(observation),
        toolName: observation.toolName,
        preview: previewOf(observation),
      },
      new Date(this.now()).toISOString(),
    );
    this.handleObservationResult(runId, entry, result);
  }

  observeText(runId: string, input: IdleLoopTextInput): void {
    const entry = this.getOrCreate(runId);
    const result = entry.detector.observeText(input, new Date(this.now()).toISOString());
    this.handleObservationResult(runId, entry, result);
  }

  noteMessageStart(runId: string, messageId: string): void {
    const entry = this.runs.get(runId);
    if (!entry) return;
    const result = entry.detector.noteMessageStart(messageId, new Date(this.now()).toISOString());
    this.handleObservationResult(runId, entry, result);
  }

  noteMessageEnd(runId: string, messageId: string): void {
    const entry = this.runs.get(runId);
    if (!entry) return;
    entry.detector.noteMessageEnd(messageId);
  }

  private handleObservationResult(
    runId: string,
    entry: RunEntry,
    result: IdleLoopObservation,
  ): void {
    if (!result.changed) return;
    const elapsed = this.now() - entry.lastPublishedAt;
    if (result.stateChanged || elapsed >= this.refreshMs) {
      this.flush(runId, entry);
      return;
    }
    if (entry.timer === undefined) {
      entry.timer = this.setTimer(() => {
        entry.timer = undefined;
        if (this.runs.get(runId) === entry) this.flush(runId, entry);
      }, this.refreshMs - elapsed);
    }
  }

  /** Mark dismissed and publish at once. False when the Run has no notice. */
  dismiss(runId: string): boolean {
    const entry = this.runs.get(runId);
    if (entry?.detector.dismiss() === undefined) return false;
    this.flush(runId, entry);
    return true;
  }

  /** Latest notice, including counts not yet published. */
  snapshot(runId: string): RunIdleLoopNotice | undefined {
    return this.runs.get(runId)?.detector.snapshot();
  }

  release(runId: string): void {
    const entry = this.runs.get(runId);
    if (entry?.timer !== undefined) this.clearTimer(entry.timer);
    this.runs.delete(runId);
  }

  private flush(runId: string, entry: RunEntry): void {
    if (entry.timer !== undefined) {
      this.clearTimer(entry.timer);
      entry.timer = undefined;
    }
    const notice = entry.detector.snapshot();
    if (notice === undefined) return;
    entry.lastPublishedAt = this.now();
    this.options.publish(runId, notice);
  }

  private getOrCreate(runId: string): RunEntry {
    const existing = this.runs.get(runId);
    if (existing) return existing;
    const created: RunEntry = {
      detector: new RunIdleLoopDetector(),
      lastPublishedAt: Number.NEGATIVE_INFINITY,
      timer: undefined,
    };
    this.runs.set(runId, created);
    return created;
  }
}

function previewOf(observation: ToolLoopObservation): string {
  const command = observation.command?.trim();
  if (command) return command;
  const preview = observation.inputPreview?.trim();
  if (preview) return preview;
  return observation.targetPaths?.join(', ') ?? '';
}
