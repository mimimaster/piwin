/**
 * Stamp first-token latency from Pi's already-parsed LLM stream events.
 *
 * Calibrated to oh-my-tps (EnderLiquid): TTFT is request-start until the
 * first non-empty `text_delta` / `thinking_delta` / `toolcall_delta`.
 * `*_start` events and empty deltas do not count. Providers do not return
 * TTFT in usage. This wrapper does not parse HTTP.
 */

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

function isLlmFirstTokenEvent(event: unknown): boolean {
  const record = asRecord(event);
  if (!record) {
    return false;
  }
  const type = readString(record.type);
  // oh-my-tps getContentDelta: non-empty delta on text / thinking / toolcall.
  if (type !== 'text_delta' && type !== 'thinking_delta' && type !== 'toolcall_delta') {
    return false;
  }
  return typeof record.delta === 'string' && record.delta.length > 0;
}

function stampFirstTokenMs(message: unknown, firstTokenMs: number): void {
  const record = asRecord(message);
  if (!record) {
    return;
  }
  record.firstTokenMs = firstTokenMs;
}

function createTimingState(nowMs: StreamRequestClock): {
  note: (event: unknown) => void;
  stampDone: (event: unknown) => void;
  firstTokenMs: () => number | undefined;
} {
  const startedAtMs = nowMs();
  let firstTokenMs: number | undefined;
  return {
    note(event: unknown): void {
      if (firstTokenMs !== undefined) {
        return;
      }
      if (!isLlmFirstTokenEvent(event)) {
        return;
      }
      const elapsed = nowMs() - startedAtMs;
      if (elapsed > 0) {
        firstTokenMs = elapsed;
      }
    },
    stampDone(event: unknown): void {
      if (firstTokenMs === undefined) {
        return;
      }
      const record = asRecord(event);
      if (!record) {
        return;
      }
      const type = readString(record.type);
      if (type === 'done') {
        stampFirstTokenMs(record.message, firstTokenMs);
        return;
      }
      if (type === 'error') {
        stampFirstTokenMs(record.error, firstTokenMs);
      }
    },
    firstTokenMs: () => firstTokenMs,
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
      const firstTokenMs = timing.firstTokenMs();
      if (firstTokenMs !== undefined) {
        stampFirstTokenMs(message, firstTokenMs);
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
