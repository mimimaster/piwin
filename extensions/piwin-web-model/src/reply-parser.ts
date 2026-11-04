/**
 * Turn whatever the model web page produced into Pi-shaped content.
 *
 * The page model has no function-calling API, so it emits the protocol as text
 * (see `TOOL_PROTOCOL` in `prompt-serializer.ts`). Parsing therefore has to be
 * forgiving in one direction only: a candidate line that fails to parse must
 * never silently become a tool call, and prose must never be thrown away.
 *
 * Invariants:
 * - Pure. Same text in, same structure out.
 * - Never throws on model output. Malformed calls are reported, not raised: the
 *   user should see the model's own words, not a stack trace.
 * - A line only counts as a call when the whole line parses as an object whose
 *   `type` is `tool_call`, whose `name` is a non-empty string and whose
 *   `arguments` is a plain object.
 */

import { TOOL_CALL_PREFIX } from './prompt-serializer.ts';

export interface ParsedToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  /** The line as it appeared, kept for diagnostics. */
  readonly raw: string;
}

export interface ParsedReply {
  /** Prose the model wrote. Empty when the reply was pure tool calls. */
  readonly text: string;
  readonly toolCalls: readonly ParsedToolCall[];
  /** Lines that looked like calls but failed validation, verbatim. */
  readonly malformed: readonly string[];
  /** Human-readable notes for the transcript (fence stripped, fence unbalanced, …). */
  readonly notes: readonly string[];
}

const FENCE = /^\s*(```|~~~)/;
const BULLET = /^\s*[-*+]\s+/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the line starts with the protocol marker, allowing list bullets. */
function looksLikeCall(line: string): boolean {
  return line.trimStart().replace(BULLET, '').startsWith(TOOL_CALL_PREFIX);
}

interface LineParse {
  readonly call?: ParsedToolCall;
  readonly malformed?: string;
}

function parseCallLine(line: string): LineParse {
  const candidate = line.trim().replace(BULLET, '');
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return { malformed: line.trim() };
  }
  if (!isPlainObject(value) || value['type'] !== 'tool_call') return { malformed: line.trim() };
  const name = value['name'];
  const args = value['arguments'] ?? value['args'];
  if (typeof name !== 'string' || name.trim() === '') return { malformed: line.trim() };
  if (!isPlainObject(args)) return { malformed: line.trim() };
  return { call: { name: name.trim(), arguments: args, raw: line.trim() } };
}

/**
 * Parse one model reply.
 *
 * Mixed content (prose plus calls) is preserved as-is instead of being forced
 * into one shape: Pi can carry both, and dropping either half loses either the
 * explanation or the action.
 *
 * Code fences are only consumed when every non-empty line inside them is a tool
 * call — models like to wrap protocol output in ```json, but a normal Markdown
 * code block must survive untouched.
 */
export function parseReply(raw: string): ParsedReply {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const prose: string[] = [];
  const calls: ParsedToolCall[] = [];
  const malformed: string[] = [];
  const notes: string[] = [];
  let strippedFences = 0;
  let sawUnclosedFence = false;
  let index = 0;

  const takeCall = (line: string): void => {
    const parsed = parseCallLine(line);
    if (parsed.call) calls.push(parsed.call);
    else if (parsed.malformed) {
      malformed.push(parsed.malformed);
      prose.push(line);
    }
  };
  const closingFence = (from: number): number => {
    for (let cursor = from; cursor < lines.length; cursor += 1) {
      if (FENCE.test(lines[cursor] ?? '')) return cursor;
    }
    return -1;
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!FENCE.test(line)) {
      if (looksLikeCall(line)) takeCall(line);
      else prose.push(line);
      index += 1;
      continue;
    }

    const close = closingFence(index + 1);
    if (close === -1) sawUnclosedFence = true;
    const end = close === -1 ? lines.length : close;
    const innerContent = lines.slice(index + 1, end).filter((entry) => entry.trim() !== '');
    if (innerContent.length > 0 && innerContent.every(looksLikeCall)) {
      for (const innerLine of innerContent) takeCall(innerLine);
      strippedFences += 1;
    } else {
      for (let cursor = index; cursor < (close === -1 ? lines.length : close + 1); cursor += 1) {
        prose.push(lines[cursor] ?? '');
      }
    }
    index = close === -1 ? lines.length : close + 1;
  }

  if (strippedFences > 0) notes.push(`stripped ${strippedFences} code fence(s) around tool calls`);
  if (sawUnclosedFence) {
    // Valid JSON means the call itself is intact; a truncated one fails to parse
    // and lands in `malformed`. The note is about how the reply was captured.
    notes.push('unbalanced code fence; the reply may have been captured before it finished');
  }
  if (malformed.length > 0) {
    notes.push(`${malformed.length} line(s) looked like tool calls but did not validate; shown as text`);
  }

  const text = prose.join('\n').trim();
  return { text, toolCalls: calls, malformed, notes };
}

export function hasToolCalls(reply: ParsedReply): boolean {
  return reply.toolCalls.length > 0;
}

/** Pi's stop reason for this reply: calls mean the agent loop must continue. */
export function stopReasonFor(reply: ParsedReply): 'stop' | 'toolUse' {
  return hasToolCalls(reply) ? 'toolUse' : 'stop';
}

/** Stable id for a parsed call; the page model never supplies one. */
export function toolCallId(index: number): string {
  return `webmodel_call_${index + 1}`;
}
