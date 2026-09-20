import { describe, expect, it } from 'vitest';
import {
  wrapLlmStreamWithRequestTiming,
  wrapStreamSimpleForRequestTiming,
} from './stream-request-timing.js';

async function collect(stream: unknown): Promise<unknown[]> {
  const events: unknown[] = [];
  if (typeof stream !== 'object' || stream === null || !(Symbol.asyncIterator in stream)) {
    return events;
  }
  for await (const event of stream as AsyncIterable<unknown>) {
    events.push(event);
  }
  return events;
}

function fakeStream(
  events: unknown[],
  resultMessage: Record<string, unknown>,
): AsyncIterable<unknown> & { result: () => Promise<unknown> } {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    result: async () => resultMessage,
  };
}

describe('wrapLlmStreamWithRequestTiming', () => {
  it('stamps firstTokenMs from the first text_delta onto the done message', async () => {
    let now = 1_000;
    const message: Record<string, unknown> = { role: 'assistant' };
    const inner = fakeStream(
      [
        { type: 'start', partial: message },
        { type: 'text_delta', delta: 'Hi', partial: message },
        { type: 'done', message },
      ],
      message,
    );
    const wrapped = wrapLlmStreamWithRequestTiming(inner, () => now);
    const iterator = (wrapped as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: 'start' });
    now = 1_350;
    expect((await iterator.next()).value).toMatchObject({ type: 'text_delta' });
    now = 3_000;
    expect((await iterator.next()).value).toMatchObject({ type: 'done' });
    expect(message.firstTokenMs).toBe(350);
    const timed = wrapped as { result: () => Promise<Record<string, unknown>> };
    await expect(timed.result()).resolves.toMatchObject({ firstTokenMs: 350 });
  });

  it('counts thinking_delta as the first token', async () => {
    let now = 5_000;
    const message: Record<string, unknown> = { role: 'assistant' };
    const wrapped = wrapLlmStreamWithRequestTiming(
      fakeStream(
        [
          { type: 'thinking_delta', delta: 'plan', partial: message },
          { type: 'done', message },
        ],
        message,
      ),
      () => now,
    );
    now = 5_080;
    await collect(wrapped);
    expect(message.firstTokenMs).toBe(80);
  });

  it('counts toolcall_delta but not toolcall_start, matching oh-my-tps', async () => {
    let now = 2_000;
    const message: Record<string, unknown> = { role: 'assistant' };
    const wrapped = wrapLlmStreamWithRequestTiming(
      fakeStream(
        [
          { type: 'toolcall_start', partial: message },
          { type: 'toolcall_delta', delta: '{"path":', partial: message },
          { type: 'done', message },
        ],
        message,
      ),
      () => now,
    );
    const iterator = (wrapped as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    await iterator.next();
    now = 2_400;
    await iterator.next();
    now = 3_000;
    await iterator.next();
    expect(message.firstTokenMs).toBe(400);
  });

  it('ignores empty deltas and leaves non-streams untouched', async () => {
    const message: Record<string, unknown> = { role: 'assistant' };
    const wrapped = wrapLlmStreamWithRequestTiming(
      fakeStream(
        [
          { type: 'text_delta', delta: '', partial: message },
          { type: 'done', message },
        ],
        message,
      ),
      () => 10,
    );
    await collect(wrapped);
    expect(message.firstTokenMs).toBeUndefined();
    expect(wrapLlmStreamWithRequestTiming({ foo: 1 })).toEqual({ foo: 1 });
  });
});

describe('wrapStreamSimpleForRequestTiming', () => {
  it('returns undefined when there is no base stream', () => {
    expect(wrapStreamSimpleForRequestTiming(undefined)).toBeUndefined();
  });

  it('forwards a non-iterable streamSimple result', () => {
    const wrapped = wrapStreamSimpleForRequestTiming(() => ({ payload: true }));
    expect(wrapped?.({ id: 'm' }, {}, {})).toEqual({ payload: true });
  });
});

describe('wrapLlmStreamWithRequestTiming push intercept', () => {
  it('stamps firstTokenMs before the original push so result() sees it', () => {
    let now = 1_000;
    const message: Record<string, unknown> = { role: 'assistant' };
    let extracted: unknown;
    const inner = {
      push(event: { type: string; message?: Record<string, unknown> }) {
        if (event.type === 'done') {
          extracted = event.message;
        }
      },
      result: async () => extracted,
    };
    const wrapped = wrapLlmStreamWithRequestTiming(inner, () => now) as typeof inner;
    wrapped.push({ type: 'start' });
    now = 1_350;
    wrapped.push({ type: 'text_delta', delta: 'Hi' } as never);
    now = 3_000;
    wrapped.push({ type: 'done', message });
    expect(message.firstTokenMs).toBe(350);
    expect(extracted).toMatchObject({ firstTokenMs: 350 });
  });
});
