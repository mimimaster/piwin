/**
 * Pure per-Run idle-loop detector (docs/plans/2026-09-28-run-idle-loop-notice.md).
 *
 * Detection only — nothing here stops or throttles the Run.
 *
 * Tool calls:
 * - Enter: the last RUN_IDLE_LOOP_WINDOW calls contain at most
 *   RUN_IDLE_LOOP_MAX_DISTINCT signatures.
 * - Stay: while looping, every call that repeats a signature already seen in
 *   the Run counts as an idle call.
 * - Recover: the last RUN_IDLE_LOOP_WINDOW calls contain more than
 *   RUN_IDLE_LOOP_MAX_DISTINCT signatures never seen before in the Run.
 *   A single stray call must not flip the state: the 2026-09-28 incident
 *   cycled through 4–5 near-identical `pwd; ls` variants for 100+ steps.
 *
 * Reply text:
 * - Enter: the streaming reply ends in one passage repeated back to back
 *   (see text-repetition.ts). Checked as the reply grows, not per delta.
 * - Recover: the looping reply finished and the model moved on (a tool call
 *   or a different assistant message). A Run that ends right after the loop
 *   stays looping, which the card reports as "until the run ended".
 *
 * One notice covers both; it is `looping` while either loop is live.
 */

import {
  RUN_IDLE_LOOP_MAX_DISTINCT,
  RUN_IDLE_LOOP_WINDOW,
  RUN_TEXT_LOOP_MAX_UNIT_PREVIEW_CHARS,
  type RunIdleLoopCall,
  type RunIdleLoopNotice,
  type RunTextRepeat,
} from '@piwin/contracts';
import { findTrailingRepetition } from './text-repetition.js';

/** Longest argument preview kept per call; the card shows one line. */
const MAX_PREVIEW_CHARS = 160;
/** A reply is re-checked after it grows by this much, or by 1/8 of its length. */
const TEXT_CHECK_MIN_STEP_CHARS = 512;

export type IdleLoopCallInput = {
  /** Stable identity of the call (tool + canonical args). */
  signature: string;
  toolName: string;
  /** Display-safe argument preview. */
  preview: string;
};

export type IdleLoopTextInput = {
  messageId: string;
  /** The whole reply so far (not a delta). */
  text: string;
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

const UNCHANGED: Pick<IdleLoopObservation, 'stateChanged' | 'changed'> = {
  stateChanged: false,
  changed: false,
};

export class RunIdleLoopDetector {
  private readonly window: WindowEntry[] = [];
  private readonly seen = new Set<string>();
  private readonly counts = new Map<string, LoopCallCount>();
  private toolIndex = 0;
  private notice: RunIdleLoopNotice | undefined;
  private toolLoop = false;
  private textLoop = false;
  /** The looping reply finished; the next sign of new work ends the text loop. */
  private textLoopMessageEnded = false;
  private textCheck = { messageId: '', length: 0 };

  observe(call: IdleLoopCallInput, now: string): IdleLoopObservation {
    const recovery = this.settleEndedTextLoop(now);
    const result = this.observeToolCall(call, now);
    if (result.changed) {
      return { ...result, stateChanged: result.stateChanged || recovery.stateChanged };
    }
    return recovery.changed ? recovery : result;
  }

  /** The reply of `messageId` grew to `text`. */
  observeText(input: IdleLoopTextInput, now: string): IdleLoopObservation {
    const { messageId, text } = input;
    if (this.textCheck.messageId !== messageId) this.textCheck = { messageId, length: 0 };
    const { length } = this.textCheck;
    if (text.length < length + Math.max(TEXT_CHECK_MIN_STEP_CHARS, Math.floor(length / 8))) {
      return { notice: this.notice, ...UNCHANGED };
    }
    this.textCheck.length = text.length;
    const found = findTrailingRepetition(text);
    if (found === undefined) return { notice: this.notice, ...UNCHANGED };

    const textRepeat: RunTextRepeat = {
      unit: found.unit.replace(/\s+/g, ' ').trim().slice(0, RUN_TEXT_LOOP_MAX_UNIT_PREVIEW_CHARS),
      repeats: found.repeats,
      chars: found.chars,
      messageId,
    };
    const previous = this.notice?.textRepeat;
    if (
      this.textLoop &&
      previous?.messageId === messageId &&
      previous.repeats === textRepeat.repeats
    ) {
      return { notice: this.notice, ...UNCHANGED };
    }
    const wasLooping = this.isLooping();
    this.textLoop = true;
    this.textLoopMessageEnded = false;
    const entering = this.notice === undefined;
    this.notice = this.withCounts({
      state: 'looping',
      textRepeat,
      updatedAt: now,
      ...(entering
        ? { firstToolIndex: this.toolIndex, lastToolIndex: this.toolIndex, detectedAt: now }
        : {}),
    });
    return { notice: this.notice, stateChanged: !wasLooping, changed: true };
  }

  /** An assistant message finished; a looping reply ending is not recovery yet. */
  noteMessageEnd(messageId: string): void {
    if (this.textLoop && this.notice?.textRepeat?.messageId === messageId) {
      this.textLoopMessageEnded = true;
    }
    if (this.textCheck.messageId === messageId) this.textCheck = { messageId: '', length: 0 };
  }

  /** A new assistant message started: after a finished text loop, the model moved on. */
  noteMessageStart(messageId: string, now: string): IdleLoopObservation {
    if (this.notice?.textRepeat?.messageId === messageId) {
      return { notice: this.notice, ...UNCHANGED };
    }
    return this.settleEndedTextLoop(now);
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

  private isLooping(): boolean {
    return this.toolLoop || this.textLoop;
  }

  private settleEndedTextLoop(now: string): IdleLoopObservation {
    if (!this.textLoop || !this.textLoopMessageEnded) return { notice: this.notice, ...UNCHANGED };
    this.textLoop = false;
    this.textLoopMessageEnded = false;
    if (this.isLooping()) {
      // The tool loop still owns the notice state; only the text part ended.
      return { notice: this.notice, ...UNCHANGED };
    }
    this.notice = this.withCounts({ state: 'recovered', updatedAt: now });
    return { notice: this.notice, stateChanged: true, changed: true };
  }

  private observeToolCall(call: IdleLoopCallInput, now: string): IdleLoopObservation {
    this.toolIndex += 1;
    const isNew = !this.seen.has(call.signature);
    this.seen.add(call.signature);
    this.window.push({ ...call, isNew });
    if (this.window.length > RUN_IDLE_LOOP_WINDOW) this.window.shift();

    if (this.toolLoop) {
      const novel = this.window.filter((entry) => entry.isNew).length;
      if (novel > RUN_IDLE_LOOP_MAX_DISTINCT) {
        this.toolLoop = false;
        this.notice = this.withCounts({
          state: this.isLooping() ? 'looping' : 'recovered',
          updatedAt: now,
        });
        return { notice: this.notice, stateChanged: !this.isLooping(), changed: true };
      }
      if (isNew) return { notice: this.notice, ...UNCHANGED };
      this.countCall(call);
      this.notice = this.withCounts({ lastToolIndex: this.toolIndex, updatedAt: now });
      return { notice: this.notice, stateChanged: false, changed: true };
    }

    const distinct = new Set(this.window.map((entry) => entry.signature)).size;
    if (this.window.length < RUN_IDLE_LOOP_WINDOW || distinct > RUN_IDLE_LOOP_MAX_DISTINCT) {
      return { notice: this.notice, ...UNCHANGED };
    }
    // Entering (or re-entering) a loop: the whole window counts as idle calls.
    const wasLooping = this.isLooping();
    for (const entry of this.window) this.countCall(entry);
    this.toolLoop = true;
    // A text-only notice has no tool episode yet, so its indices are not ours.
    const resumesEpisode = (this.notice?.repeatedCalls ?? 0) > 0;
    this.notice = this.withCounts({
      state: 'looping',
      firstToolIndex:
        resumesEpisode && this.notice
          ? this.notice.firstToolIndex
          : this.toolIndex - this.window.length + 1,
      lastToolIndex: this.toolIndex,
      detectedAt: this.notice?.detectedAt ?? now,
      updatedAt: now,
    });
    // Re-entry must not double-count calls already inside the previous episode.
    this.window.length = 0;
    return { notice: this.notice, stateChanged: !wasLooping, changed: true };
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
