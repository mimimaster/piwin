/**
 * Run idle-loop notice (docs/plans/2026-09-28-run-idle-loop-notice.md).
 *
 * Detection only: the Host flags a Run whose recent tool calls keep
 * repeating the same few signatures, and never stops it. Idle loops are
 * almost always upstream (provider context loss, model degeneration), so the
 * notice tells the user rather than intervening.
 */

/** Recent tool calls inspected for repetition. */
export const RUN_IDLE_LOOP_WINDOW = 12;
/** A window with at most this many distinct call signatures is a loop. */
export const RUN_IDLE_LOOP_MAX_DISTINCT = 3;
/** Count-only updates are published at most this often. */
export const RUN_IDLE_LOOP_REFRESH_MS = 3_000;

export type RunIdleLoopState = 'looping' | 'recovered';

/** One repeated call, bounded for display. */
export type RunIdleLoopCall = {
  toolName: string;
  /** Display-safe, clipped argument preview (never a full payload). */
  preview: string;
  count: number;
};

export type RunIdleLoopNotice = {
  state: RunIdleLoopState;
  /** Calls made while looping, across every looping episode of the Run. */
  repeatedCalls: number;
  /** Most frequent loop calls, at most RUN_IDLE_LOOP_MAX_DISTINCT per episode. */
  calls: RunIdleLoopCall[];
  /** 1-based tool-call index where the first looping window began. */
  firstToolIndex: number;
  /** 1-based tool-call index of the latest looping call. */
  lastToolIndex: number;
  detectedAt: string;
  updatedAt: string;
  /** User closed the card; it must not reappear for this Run. */
  dismissed?: boolean;
};
