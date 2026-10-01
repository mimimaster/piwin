/**
 * Run idle-loop notice (docs/plans/2026-09-28-run-idle-loop-notice.md).
 *
 * Detection only: the Host flags a Run whose recent tool calls keep
 * repeating the same few signatures, or whose reply repeats one passage, and
 * never stops it. Idle loops are
 * almost always upstream (provider context loss, model degeneration), so the
 * notice tells the user rather than intervening.
 */

/** Recent tool calls inspected for repetition. */
export const RUN_IDLE_LOOP_WINDOW = 12;
/** A window with at most this many distinct call signatures is a loop. */
export const RUN_IDLE_LOOP_MAX_DISTINCT = 3;
/** Count-only updates are published at most this often. */
export const RUN_IDLE_LOOP_REFRESH_MS = 3_000;
/**
 * Text loop: a reply whose tail is one unit of at least this many characters
 * repeated back to back. Shorter units are separators, table rules or list
 * markers, which legitimate output repeats freely.
 */
export const RUN_TEXT_LOOP_MIN_UNIT_CHARS = 24;
/** ... repeated at least this many times in a row. */
export const RUN_TEXT_LOOP_MIN_REPEATS = 6;
/** Longest repeating unit clipped into the notice; the card shows one line. */
export const RUN_TEXT_LOOP_MAX_UNIT_PREVIEW_CHARS = 160;

export type RunIdleLoopState = 'looping' | 'recovered';

/** One repeated call, bounded for display. */
export type RunIdleLoopCall = {
  toolName: string;
  /** Display-safe, clipped argument preview (never a full payload). */
  preview: string;
  count: number;
};

/**
 * A reply that degenerated into repeating one passage (2026-09-30
 * session-muny5im0-8df7puba: one sentence 748 times in a single message).
 */
export type RunTextRepeat = {
  /** Clipped repeating unit (the last full repetition in the reply). */
  unit: string;
  /** Back-to-back repetitions of the unit at the tail of the reply. */
  repeats: number;
  /** Length in characters of the repeating tail. */
  chars: number;
  /** Assistant message that holds the repetition. */
  messageId: string;
};

export type RunIdleLoopNotice = {
  state: RunIdleLoopState;
  /**
   * Tool calls made while looping, across every looping episode of the Run.
   * Zero when the notice was raised only by a text loop.
   */
  repeatedCalls: number;
  /** Most frequent loop calls, at most RUN_IDLE_LOOP_MAX_DISTINCT per episode. */
  calls: RunIdleLoopCall[];
  /** 1-based tool-call index where the first looping window began. */
  firstToolIndex: number;
  /** 1-based tool-call index of the latest looping call. */
  lastToolIndex: number;
  detectedAt: string;
  updatedAt: string;
  /** Worst text loop of the Run; independent of the tool-call loop. */
  textRepeat?: RunTextRepeat;
  /** User closed the card; it must not reappear for this Run. */
  dismissed?: boolean;
};
