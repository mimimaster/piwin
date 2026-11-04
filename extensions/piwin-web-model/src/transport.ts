/**
 * Shape a page-model reply into Pi's `AssistantMessageEvent` protocol.
 *
 * Split on purpose:
 * - `planReplyEvents` is pure and dependency-free, so the tricky part (what a
 *   reply turns into) is tested without loading Pi or a browser.
 * - `createWebModelStream` is the thin adapter that lazily imports
 *   `@earendil-works/pi-ai` and pushes those events into its stream, which keeps
 *   the extension importable in a plain `node --test` run.
 *
 * Invariants:
 * - Text the user can see is never dropped: an unparseable protocol line stays
 *   in the message as text.
 * - `done` always carries the complete message; deltas are best-effort.
 */

import { toolCallId, parseReply, stopReasonFor, type ParsedReply, type ParsedToolCall } from './reply-parser.ts';

export interface ReplyEventMeta {
  readonly api: string;
  readonly provider: string;
  readonly model: string;
  readonly timestamp: number;
}

export interface PlannedToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  /** JSON as it is reported back to Pi, already validated. */
  readonly json: string;
}

export type PlannedContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'toolCall'; readonly call: PlannedToolCall };

export interface PlannedReply {
  readonly reply: ParsedReply;
  readonly content: readonly PlannedContent[];
  readonly stopReason: 'stop' | 'toolUse';
}

function planCall(call: ParsedToolCall, index: number): PlannedToolCall {
  return {
    id: toolCallId(index),
    name: call.name,
    arguments: call.arguments,
    json: JSON.stringify(call.arguments),
  };
}

/** Decide what a settled reply text means, without touching Pi or the DOM. */
export function planReply(text: string): PlannedReply {
  const reply = parseReply(text);
  const content: PlannedContent[] = [];
  if (reply.text.length > 0) content.push({ type: 'text', text: reply.text });
  reply.toolCalls.forEach((call, index) => {
    content.push({ type: 'toolCall', call: planCall(call, index) });
  });
  return { reply, content, stopReason: stopReasonFor(reply) };
}

/**
 * Text to emit for one streaming update, or undefined when the page text did not
 * simply grow (a re-render, an edit, a shrinking transcript).
 *
 * Best-effort by contract: `done` carries the authoritative text, so a missed
 * delta costs nothing but a slightly chunkier repaint.
 */
export function nextTextDelta(previous: string, next: string): string | undefined {
  if (next === previous) return undefined;
  if (next.startsWith(previous)) {
    const delta = next.slice(previous.length);
    return delta.length > 0 ? delta : undefined;
  }
  return undefined;
}

export interface WebModelStreamInput {
  readonly model: { readonly api: string; readonly provider: string; readonly id: string };
  /** Progressive renderings of the same reply; the last one is authoritative. */
  readonly stream: AsyncIterable<string>;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly onNote?: (note: string) => void;
}

export type StreamOutcome =
  | { readonly ok: true; readonly stopReason: 'stop' | 'toolUse' }
  | { readonly ok: false; readonly error: string };

/** The slice of Pi's `AssistantMessageEventStream` this module needs. */
export interface StreamSink {
  push(event: unknown): void;
  end(result?: unknown): void;
}

function emptyUsage(): unknown {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(
  meta: ReplyEventMeta,
  content: unknown[],
  stopReason: string,
  errorMessage?: string,
): Record<string, unknown> {
  return {
    role: 'assistant',
    content,
    api: meta.api,
    provider: meta.provider,
    model: meta.model,
    usage: emptyUsage(),
    stopReason: errorMessage === undefined ? stopReason : 'error',
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: meta.timestamp,
  };
}

/**
 * Drive one Pi stream from a page reply.
 *
 * The caller supplies the sink (Pi's `createAssistantMessageEventStream()` in
 * production, a recorder in tests) so this module never imports Pi: that is what
 * lets the event shaping be tested in a plain `node --test` run.
 *
 * Never throws: a failed turn already pushed an `error` event, and the caller
 * must not report the same failure twice.
 */
export async function runWebModelStream(input: WebModelStreamInput, sink: StreamSink): Promise<StreamOutcome> {
  const now = input.now ?? Date.now;
  const meta: ReplyEventMeta = {
    api: input.model.api,
    provider: input.model.provider,
    model: input.model.id,
    timestamp: now(),
  };
  const partial = assistantMessage(meta, [], 'pending');
  sink.push({ type: 'start', partial: { ...partial } });

  let text = '';
  let streaming = false;
  const textIndex = 0;

  try {
    for await (const snapshot of input.stream) {
      if (input.signal?.aborted === true) throw new Error('aborted');
      const delta = nextTextDelta(text, snapshot);
      if (delta === undefined) continue;
      text = snapshot;
      if (!streaming) {
        streaming = true;
        sink.push({ type: 'text_start', contentIndex: textIndex, partial: { ...partial } });
      }
      sink.push({ type: 'text_delta', contentIndex: textIndex, delta, partial: { ...partial } });
    }
  } catch (error) {
    const message = (error as Error).message;
    sink.push({ type: 'error', reason: 'error', error: assistantMessage(meta, [], 'error', message) });
    sink.end();
    return { ok: false, error: message };
  }

  const planned = planReply(text);
  for (const note of planned.reply.notes) input.onNote?.(note);
  const content: unknown[] = [];
  if (planned.reply.text.length > 0) {
    content.push({ type: 'text', text: planned.reply.text });
    if (streaming) {
      sink.push({ type: 'text_end', contentIndex: textIndex, content: planned.reply.text, partial: { ...partial } });
    }
  } else if (streaming) {
    sink.push({ type: 'text_end', contentIndex: textIndex, content: '', partial: { ...partial } });
  }

  for (const entry of planned.content) {
    if (entry.type !== 'toolCall') continue;
    const call = entry.call;
    const contentIndex = content.length;
    content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments });
    sink.push({ type: 'toolcall_start', contentIndex, partial: { ...partial } });
    sink.push({ type: 'toolcall_delta', contentIndex, delta: call.json, partial: { ...partial } });
    sink.push({
      type: 'toolcall_end',
      contentIndex,
      toolCall: { type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments },
      partial: { ...partial },
    });
  }

  const final = assistantMessage(meta, content, planned.stopReason);
  sink.push({ type: 'done', reason: planned.stopReason, message: final });
  sink.end(final);
  return { ok: true, stopReason: planned.stopReason };
}
