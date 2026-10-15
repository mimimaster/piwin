/**
 * Cut a model response whose reasoning degenerates into a verbatim loop, and
 * retry it once or twice with a short corrective note (ADR 0092).
 *
 * Why: DeepSeek V4.1 Flash in thinking mode can stream the same reasoning
 * passage over and over until it hits the output-token ceiling. Nothing
 * downstream can help — Pi only acts once the message ends, and the Host
 * idle-loop notice watches reply text, not reasoning. The stream itself is
 * the only place that can stop the spend while it happens.
 *
 * How: the guard wraps `ModelRuntime.streamSimple`. It keeps the stream
 * object Pi already iterates and intercepts its `push`/`end`, so Pi's
 * agent-loop never sees a second `start`. On a loop it aborts the upstream
 * request, drops whatever that request still emits, and pumps a fresh
 * request into the same object. The retry context is the original context
 * plus one ephemeral user note; the looped attempt is never part of any
 * persisted message. When the retry budget is spent, or the attempt already
 * streamed answer text or a tool call, the guard ends the response with an
 * error instead of letting it run to the token limit.
 *
 * Known gaps: live clients keep showing the discarded attempt's reasoning
 * deltas (the message they finally receive is clean); the discarded
 * attempt's token usage is lost because providers report it at stream end.
 */

import type { Context, UserMessage } from '@earendil-works/pi-ai';
import { findTrailingRepetition, type TrailingRepetition } from '@piwin/contracts';
import { asRecord, readString } from './pi-event-read.js';

/** Shortest repeated reasoning unit that counts as a loop. */
export const REASONING_LOOP_MIN_UNIT_CHARS = 24;
/** Back-to-back copies needed before the guard intervenes. */
export const REASONING_LOOP_MIN_REPEATS = 5;
/** The looped tail must cover at least this much text; short echoes are left alone. */
export const REASONING_LOOP_MIN_LOOP_CHARS = 600;
/** Fresh requests per model call before the guard gives up and fails the response. */
export const REASONING_LOOP_MAX_RETRIES = 2;
/** Paragraph-sized loops need room for `MIN_REPEATS` copies in the scanned tail. */
const TAIL_WINDOW_CHARS = 16_384;
/** Reasoning is re-checked after it grows by this much, or by 1/8 of its length. */
const CHECK_MIN_STEP_CHARS = 512;
/** Longest looped passage quoted back to the model. */
const UNIT_PREVIEW_CHARS = 240;

type StreamSimple = (model: unknown, context: unknown, options?: unknown) => unknown;

type PushEndStream = {
  push: (event: unknown) => void;
  end: (result?: unknown) => void;
};

function isPushEndStream(value: unknown): value is PushEndStream {
  const record = value as Partial<PushEndStream> | null;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof record?.push === 'function' &&
    typeof record.end === 'function'
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<AsyncIterable<unknown>>)[Symbol.asyncIterator] === 'function'
  );
}

function isPiContext(value: unknown): value is Context {
  const record = asRecord(value);
  return record !== null && Array.isArray(record.messages);
}

function readSignal(options: unknown): AbortSignal | undefined {
  const signal = asRecord(options)?.signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

/** One upstream request's controller, aborted with the caller's signal too. */
function createLinkedController(parent: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (parent?.aborted) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener('abort', () => controller.abort(parent.reason), { once: true });
  }
  return controller;
}

function withSignal(options: unknown, signal: AbortSignal): Record<string, unknown> {
  return { ...(asRecord(options) ?? {}), signal };
}

function previewUnit(unit: string): string {
  const trimmed = unit.trim();
  return trimmed.length <= UNIT_PREVIEW_CHARS
    ? trimmed
    : `${trimmed.slice(0, UNIT_PREVIEW_CHARS)}…`;
}

/** The ephemeral note appended to a retry request; never persisted. */
export function createReasoningLoopRetryNote(
  repetition: TrailingRepetition,
  now: () => number = Date.now,
): UserMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text:
          '[piwin] Your previous attempt at this reply was stopped because its reasoning ' +
          `repeated the same passage verbatim ${repetition.repeats} times:\n\n` +
          `> ${previewUnit(repetition.unit)}\n\n` +
          'That attempt was discarded. Do not restart that line of reasoning. Reason briefly ' +
          'from where the conversation stands, then call a tool or give your answer.',
      },
    ],
    timestamp: now(),
  };
}

export function reasoningLoopFailureMessage(repetition: TrailingRepetition, retries: number): string {
  const retried = retries > 0 ? ` after ${retries} fresh attempt${retries === 1 ? '' : 's'}` : '';
  return (
    `Reasoning loop: the model repeated the same reasoning passage ${repetition.repeats} times` +
    `${retried}, so piwin stopped the response before it reached the output limit.`
  );
}

export function detectReasoningLoop(thinking: string): TrailingRepetition | undefined {
  const found = findTrailingRepetition(thinking, {
    minUnitChars: REASONING_LOOP_MIN_UNIT_CHARS,
    minRepeats: REASONING_LOOP_MIN_REPEATS,
    tailWindowChars: TAIL_WINDOW_CHARS,
  });
  return found !== undefined && found.chars >= REASONING_LOOP_MIN_LOOP_CHARS ? found : undefined;
}

type AttemptState = {
  id: number;
  controller: AbortController;
  thinking: string;
  checkedLength: number;
  /** Answer text or tool-call arguments already reached clients. */
  visibleOutput: boolean;
};

/**
 * Guard one `streamSimple` call. Returns the stream Pi iterates; when the
 * base stream is not a push stream the call passes through unguarded.
 */
export function guardReasoningLoopStream(
  base: StreamSimple,
  model: unknown,
  context: unknown,
  options?: unknown,
): unknown {
  if (!isPiContext(context)) {
    return base(model, context, options);
  }
  const piContext = context;
  const parentSignal = readSignal(options);
  let attempt: AttemptState = newAttempt(0, parentSignal);
  const stream = base(model, context, withSignal(options, attempt.controller.signal));
  if (!isPushEndStream(stream)) {
    return stream;
  }
  const forward = stream.push.bind(stream);
  const finish = stream.end.bind(stream);
  let retries = 0;
  let lastPartial: Record<string, unknown> | undefined;
  let settled = false;

  /** Returns false once the event's attempt is no longer the live one. */
  function observe(attemptId: number, event: unknown): boolean {
    if (settled || attemptId !== attempt.id) {
      return false;
    }
    const record = asRecord(event);
    const type = readString(record?.type);
    const partial = asRecord(record?.partial);
    if (partial) lastPartial = partial;
    if (type === 'start' && attemptId > 0) {
      // Pi already holds the first attempt's partial message.
      return true;
    }
    if (type === 'text_delta' || type === 'toolcall_delta') {
      attempt.visibleOutput = true;
    } else if (type === 'thinking_delta') {
      attempt.thinking += readString(record?.delta) ?? '';
      const loop = checkThinking(attempt);
      if (loop) {
        cut(loop);
        return false;
      }
    }
    if (type === 'done' || type === 'error') {
      settled = true;
    }
    forward(event);
    return true;
  }

  function cut(loop: TrailingRepetition): void {
    attempt.controller.abort(new Error('reasoning loop detected'));
    if (parentSignal?.aborted) {
      return;
    }
    if (retries < REASONING_LOOP_MAX_RETRIES && !attempt.visibleOutput) {
      retries += 1;
      attempt = newAttempt(attempt.id + 1, parentSignal);
      const retryContext: Context = {
        ...piContext,
        messages: [...piContext.messages, createReasoningLoopRetryNote(loop)],
      };
      void pumpRetry(attempt.id, base(model, retryContext, withSignal(options, attempt.controller.signal)));
      return;
    }
    fail(reasoningLoopFailureMessage(loop, retries));
  }

  async function pumpRetry(attemptId: number, retryStream: unknown): Promise<void> {
    try {
      if (!isAsyncIterable(retryStream)) {
        throw new Error('retry stream is not iterable');
      }
      for await (const event of retryStream) {
        if (!observe(attemptId, event)) break;
      }
      if (attemptId === attempt.id) finish();
    } catch (error: unknown) {
      if (attemptId === attempt.id) {
        fail(`Reasoning loop retry failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  function fail(errorMessage: string): void {
    if (settled) return;
    settled = true;
    const error = { ...(lastPartial ?? { role: 'assistant', content: [] }), stopReason: 'error', errorMessage };
    forward({ type: 'error', reason: 'error', error });
    finish();
  }

  stream.push = (event: unknown) => {
    observe(0, event);
  };
  stream.end = (result?: unknown) => {
    // The first provider still calls end() after it was aborted for a retry.
    if (attempt.id === 0) finish(result);
  };
  return stream;
}

function newAttempt(id: number, parentSignal: AbortSignal | undefined): AttemptState {
  return {
    id,
    controller: createLinkedController(parentSignal),
    thinking: '',
    checkedLength: 0,
    visibleOutput: false,
  };
}

function checkThinking(attempt: AttemptState): TrailingRepetition | undefined {
  const length = attempt.thinking.length;
  const step = Math.max(CHECK_MIN_STEP_CHARS, Math.floor(attempt.checkedLength / 8));
  if (length - attempt.checkedLength < step) {
    return undefined;
  }
  attempt.checkedLength = length;
  return detectReasoningLoop(attempt.thinking);
}

/**
 * Patch `ModelRuntime.streamSimple` so every agent request is guarded. Call
 * after `wrapModelRuntimeStreamTiming` so retries keep first-token timing.
 */
export function wrapModelRuntimeReasoningLoopGuard(runtime: object): void {
  const record = runtime as { streamSimple?: StreamSimple };
  const original = record.streamSimple;
  if (typeof original !== 'function') {
    return;
  }
  const base: StreamSimple = (model, context, options) => original.call(runtime, model, context, options);
  record.streamSimple = (model, context, options) =>
    guardReasoningLoopStream(base, model, context, options);
}
