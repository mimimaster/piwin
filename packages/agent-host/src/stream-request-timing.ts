/**
 * Stamp first-token latency from Pi's already-parsed LLM stream events.
 *
 * Calibrated to oh-my-tps (EnderLiquid): TTFT is request-start until the
 * first non-empty `text_delta` / `thinking_delta` / `toolcall_delta`.
 * `*_start` events and empty deltas do not count. Providers do not return
 * TTFT in usage. This wrapper does not parse HTTP.
 *
 * The kind of that first delta is stamped too: output speed needs to know
 * whether reasoning was streamed or ran unseen during the first-token wait.
 */

import type { UsageFirstTokenKind } from '@piwin/contracts';
import type { NativeSearchStreamSimple } from './native-web-search.js';
import { asRecord, readString } from './pi-event-read.js';

export type StreamRequestClock = () => number;

type PushStream = {
  push: (event: unknown) => void;
  result?: () => Promise<unknown>;
};

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  );
}

function isPushStream(value: unknown): value is PushStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PushStream).push === 'function'
  );
}

type FirstToken = { firstTokenMs: number; firstTokenKind: UsageFirstTokenKind };

function readLlmFirstTokenKind(event: unknown): UsageFirstTokenKind | undefined {
  const record = asRecord(event);
  if (!record) {
    return undefined;
  }
  const type = readString(record.type);
  // oh-my-tps getContentDelta: non-empty delta on text / thinking / toolcall.
  if (type !== 'text_delta' && type !== 'thinking_delta' && type !== 'toolcall_delta') {
    return undefined;
  }
  if (typeof record.delta !== 'string' || record.delta.length === 0) {
    return undefined;
  }
  return type === 'thinking_delta' ? 'reasoning' : 'content';
}

function stampFirstToken(message: unknown, firstToken: FirstToken): void {
  const record = asRecord(message);
  if (!record) {
    return;
  }
  record.firstTokenMs = firstToken.firstTokenMs;
  record.firstTokenKind = firstToken.firstTokenKind;
}

function createTimingState(nowMs: StreamRequestClock): {
  note: (event: unknown) => void;
  stampDone: (event: unknown) => void;
  firstToken: () => FirstToken | undefined;
} {
  const startedAtMs = nowMs();
  let firstToken: FirstToken | undefined;
  return {
    note(event: unknown): void {
      if (firstToken !== undefined) {
        return;
      }
      const firstTokenKind = readLlmFirstTokenKind(event);
      if (firstTokenKind === undefined) {
        return;
      }
      const elapsed = nowMs() - startedAtMs;
      if (elapsed > 0) {
        firstToken = { firstTokenMs: elapsed, firstTokenKind };
      }
    },
    stampDone(event: unknown): void {
      if (firstToken === undefined) {
        return;
      }
      const record = asRecord(event);
      if (!record) {
        return;
      }
      const type = readString(record.type);
      if (type === 'done') {
        stampFirstToken(record.message, firstToken);
        return;
      }
      if (type === 'error') {
        stampFirstToken(record.error, firstToken);
      }
    },
    firstToken: () => firstToken,
  };
}

/**
 * Observe Pi LLM stream events and write `firstTokenMs` onto the assistant
 * message when the first contentful chunk arrives after stream() start.
 *
 * Prefer intercepting `push` so Pi keeps its AssistantMessageEventStream
 * identity (lazyStream + result()). Fall back to wrapping the async iterator.
 */
export function wrapLlmStreamWithRequestTiming(
  inner: unknown,
  nowMs: StreamRequestClock = Date.now,
): unknown {
  if (isPushStream(inner)) {
    const timing = createTimingState(nowMs);
    const originalPush = inner.push.bind(inner);
    inner.push = (event: unknown) => {
      timing.note(event);
      timing.stampDone(event);
      originalPush(event);
    };
    return inner;
  }
  if (!isAsyncIterable(inner)) {
    return inner;
  }
  const timing = createTimingState(nowMs);
  const timed: {
    [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
    result?: () => Promise<unknown>;
  } = {
    [Symbol.asyncIterator]: async function* wrapTimingIterator() {
      for await (const event of inner) {
        timing.note(event);
        timing.stampDone(event);
        yield event;
      }
    },
  };
  const innerRecord = inner as { result?: () => Promise<unknown> };
  if (typeof innerRecord.result === 'function') {
    const result = innerRecord.result.bind(innerRecord);
    timed.result = async () => {
      const message = await result();
      const firstToken = timing.firstToken();
      if (firstToken !== undefined) {
        stampFirstToken(message, firstToken);
      }
      return message;
    };
  }
  return timed;
}

export function wrapStreamSimpleForRequestTiming(
  base: NativeSearchStreamSimple | undefined,
  nowMs: StreamRequestClock = Date.now,
): NativeSearchStreamSimple | undefined {
  if (!base) {
    return undefined;
  }
  return (model, context, options) =>
    wrapLlmStreamWithRequestTiming(base(model, context, options), nowMs);
}

type RuntimeStreamSimple = (
  model: unknown,
  context: unknown,
  options?: unknown,
) => unknown;

/**
 * Agent sessions call `ModelRuntime.streamSimple`, not the provider overlay.
 * Patch that method so OAuth builtins (xai/Codex/Anthropic) get firstTokenMs
 * on the stream result that agent-loop writes to `message_end`.
 */
export function wrapModelRuntimeStreamTiming(
  runtime: object,
  nowMs: StreamRequestClock = Date.now,
): void {
  const record = runtime as { streamSimple?: RuntimeStreamSimple };
  const original = record.streamSimple;
  if (typeof original !== 'function') {
    return;
  }
  record.streamSimple = (model, context, options) =>
    wrapLlmStreamWithRequestTiming(original.call(runtime, model, context, options), nowMs);
}
