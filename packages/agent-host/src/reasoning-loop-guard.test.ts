import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  detectReasoningLoop,
  guardReasoningLoopStream,
  REASONING_LOOP_MAX_RETRIES,
} from './reasoning-loop-guard.js';

const LOOP_PASSAGE =
  'Wait, I should double-check the config loader before editing anything, so let me re-read it. ';

type Script = Array<{ type: 'thinking' | 'text'; text: string }>;

type Call = { context: { messages: unknown[] }; signal: AbortSignal | undefined };

function partial(thinking: string, text: string): Record<string, unknown> {
  const content: unknown[] = [];
  if (thinking) content.push({ type: 'thinking', thinking });
  if (text) content.push({ type: 'text', text });
  return { role: 'assistant', content, stopReason: 'stop', model: 'ds-flash' };
}

/**
 * A provider that streams each script entry as one delta per macrotask and
 * honours abort the way Pi providers do: push an aborted error, then end().
 */
function scriptedBase(scripts: Script[]): {
  base: (model: unknown, context: unknown, options?: unknown) => unknown;
  calls: Call[];
} {
  const calls: Call[] = [];
  const base = (_model: unknown, context: unknown, options?: unknown) => {
    const script = scripts[calls.length] ?? [];
    const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
    calls.push({ context: context as Call['context'], signal });
    const stream = createAssistantMessageEventStream();
    void (async () => {
      let thinking = '';
      let text = '';
      stream.push({ type: 'start', partial: partial('', '') } as never);
      for (const step of script) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (signal?.aborted) {
          stream.push({
            type: 'error',
            reason: 'aborted',
            error: { ...partial(thinking, text), stopReason: 'aborted' },
          } as never);
          stream.end();
          return;
        }
        if (step.type === 'thinking') thinking += step.text;
        else text += step.text;
        stream.push({
          type: step.type === 'thinking' ? 'thinking_delta' : 'text_delta',
          contentIndex: 0,
          delta: step.text,
          partial: partial(thinking, text),
        } as never);
      }
      stream.push({ type: 'done', reason: 'stop', message: partial(thinking, text) } as never);
      stream.end();
    })();
    return stream;
  };
  return { base, calls };
}

function loopScript(copies: number): Script {
  return Array.from({ length: copies }, () => ({ type: 'thinking' as const, text: LOOP_PASSAGE }));
}

async function drain(stream: unknown): Promise<{ events: Array<Record<string, unknown>>; result: Record<string, unknown> }> {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of stream as AsyncIterable<Record<string, unknown>>) events.push(event);
  const result = (await (stream as { result: () => Promise<unknown> }).result()) as Record<string, unknown>;
  return { events, result };
}

const context = () => ({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'fix it', timestamp: 1 }] });

describe('detectReasoningLoop', () => {
  it('flags a paragraph repeated back to back', () => {
    expect(detectReasoningLoop(`Plan first.\n${LOOP_PASSAGE.repeat(8)}`)?.repeats).toBe(8);
  });

  it('leaves short echoes and ordinary reasoning alone', () => {
    expect(detectReasoningLoop('Let me check the file again. '.repeat(5))).toBeUndefined();
    const reasoning = Array.from({ length: 200 }, (_, index) => `Step ${index}: look at module ${index * 3}.`).join(' ');
    expect(detectReasoningLoop(reasoning)).toBeUndefined();
  });

  it('finds a long paragraph loop', () => {
    const paragraph = `${'The loader merges defaults, then env, then file values; '.repeat(20)}\n`;
    expect(paragraph.length).toBeGreaterThan(1_000);
    expect(detectReasoningLoop(paragraph.repeat(6))?.repeats).toBeGreaterThanOrEqual(5);
  });
});

describe('guardReasoningLoopStream', () => {
  it('passes a healthy response through untouched', async () => {
    const { base, calls } = scriptedBase([
      [
        { type: 'thinking', text: 'Read the loader. ' },
        { type: 'text', text: 'Done.' },
      ],
    ]);
    const { events, result } = await drain(guardReasoningLoopStream(base, {}, context(), {}));
    expect(calls).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(['start', 'thinking_delta', 'text_delta', 'done']);
    expect(result.content).toEqual([
      { type: 'thinking', thinking: 'Read the loader. ' },
      { type: 'text', text: 'Done.' },
    ]);
  });

  it('cuts a looping attempt and retries with a corrective note', async () => {
    const { base, calls } = scriptedBase([
      loopScript(200),
      [
        { type: 'thinking', text: 'Edit the loader directly. ' },
        { type: 'text', text: 'Patched.' },
      ],
    ]);
    const { events, result } = await drain(guardReasoningLoopStream(base, {}, context(), {}));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal?.aborted).toBe(true);
    // The loop is cut long before the 200 copies the provider would stream.
    const loopDeltas = events.filter((event) => event.type === 'thinking_delta').length;
    expect(loopDeltas).toBeLessThan(40);
    expect(events.filter((event) => event.type === 'start')).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('done');
    expect(result.content).toEqual([
      { type: 'thinking', thinking: 'Edit the loader directly. ' },
      { type: 'text', text: 'Patched.' },
    ]);
    const retryMessages = calls[1]?.context.messages ?? [];
    expect(retryMessages).toHaveLength(2);
    const note = JSON.stringify(retryMessages[1]);
    expect(note).toContain('repeated the same passage verbatim');
    expect(note).toContain('double-check the config loader');
  });

  it('fails the response once the retry budget is spent', async () => {
    const { base, calls } = scriptedBase(
      Array.from({ length: REASONING_LOOP_MAX_RETRIES + 1 }, () => loopScript(200)),
    );
    const { events, result } = await drain(guardReasoningLoopStream(base, {}, context(), {}));
    expect(calls).toHaveLength(REASONING_LOOP_MAX_RETRIES + 1);
    expect(events.at(-1)?.type).toBe('error');
    expect(result.stopReason).toBe('error');
    expect(String(result.errorMessage)).toMatch(/^Reasoning loop: .*after 2 fresh attempts/);
  });

  it('does not retry once answer text has streamed', async () => {
    const { base, calls } = scriptedBase([[{ type: 'text', text: 'Looking. ' }, ...loopScript(200)]]);
    const { result } = await drain(guardReasoningLoopStream(base, {}, context(), {}));
    expect(calls).toHaveLength(1);
    expect(result.stopReason).toBe('error');
    expect(String(result.errorMessage)).not.toContain('fresh attempt');
  });

  it('lets a caller abort win over the guard', async () => {
    const controller = new AbortController();
    const { base, calls } = scriptedBase([loopScript(200)]);
    const stream = guardReasoningLoopStream(base, {}, context(), { signal: controller.signal });
    controller.abort();
    const { result } = await drain(stream);
    expect(calls).toHaveLength(1);
    expect(result.stopReason).toBe('aborted');
  });
});
