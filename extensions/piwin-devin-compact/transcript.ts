import {
  DEVIN_MESSAGE_KEEP_BYTES,
  DEVIN_MESSAGE_LIMIT_BYTES,
  DEVIN_TRANSCRIPT_LIMIT_BYTES,
  DEVIN_TRANSCRIPT_SEPARATOR,
  devinMessageHeader,
  devinOmittedMarker,
  devinTruncatedMarker,
} from './prompt.js';
import { asArray, asLoose, asString } from './values.js';

/** One rendered Devin history line: `=== MESSAGE n - Role ===\n<text>`. */
export type RenderedMessage = {
  /** Role label exactly as Devin prints it (System/User/Assistant/Tool). */
  role: string;
  /** Text body. Devin renders tool calls as empty bodies, so this may be "". */
  text: string;
};

const ROLE_LABELS: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
  toolResult: 'Tool',
  tool: 'Tool',
  bashExecution: 'Tool',
  system: 'System',
  developer: 'System',
};

/** Devin's history renderer keeps text blocks only; tool calls become empty. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of asArray(content)) {
    const loose = asLoose(block);
    const type = asString(loose?.type);
    if (type === 'text') {
      const text = asString(loose?.text);
      if (text !== undefined) parts.push(text);
    } else if (type === 'image') {
      parts.push('[image]');
    }
  }
  return parts.join('\n');
}

function isContinuationByte(value: number | undefined): boolean {
  return value !== undefined && (value & 0xc0) === 0x80;
}

/**
 * Devin caps every rendered message at 8000 bytes: it keeps the first and last
 * 4000 bytes on UTF-8 boundaries and reports the remainder. Long tool results
 * therefore reach the summarizer as head + tail, never in full.
 */
export function truncateMessageText(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= DEVIN_MESSAGE_LIMIT_BYTES) return text;
  let headEnd = DEVIN_MESSAGE_KEEP_BYTES;
  while (headEnd > 0 && isContinuationByte(bytes[headEnd])) headEnd -= 1;
  let tailStart = bytes.length - DEVIN_MESSAGE_KEEP_BYTES;
  while (tailStart > 0 && isContinuationByte(bytes[tailStart])) tailStart -= 1;
  const truncated = bytes.length - DEVIN_MESSAGE_LIMIT_BYTES;
  return `${bytes.subarray(0, headEnd).toString('utf8')}${devinTruncatedMarker(truncated)}${bytes.subarray(tailStart).toString('utf8')}`;
}

export function toRenderedMessage(message: unknown): RenderedMessage | undefined {
  const loose = asLoose(message);
  if (!loose) return undefined;
  const rawRole = asString(loose.role);
  if (!rawRole) return undefined;
  const role = ROLE_LABELS[rawRole];
  if (!role) return undefined;
  return { role, text: truncateMessageText(contentToText(loose.content)) };
}

/**
 * Renders the transcript exactly like `agent-ext/src/compactor/file_compactor.rs`:
 * every message becomes `=== MESSAGE {i} - {Role} ===\n{text}` with a running
 * index over the summarized range, and messages are joined with a blank line.
 */
export function renderMessages(messages: readonly RenderedMessage[]): string {
  return messages
    .map((message, index) => `${devinMessageHeader(index, message.role)}\n${message.text}`)
    .join(DEVIN_TRANSCRIPT_SEPARATOR);
}

export type Elision = {
  /** Transcript actually sent to the summarizer. */
  text: string;
  /** How many messages the middle-elision dropped (0 when nothing was cut). */
  omitted: number;
};

/**
 * Devin measures the *joined* transcript in bytes and only elides from
 * 200001 bytes up. It then keeps the first `n / 2` rendered messages and the
 * last `n / 4`, replacing everything between with a single marker line.
 *
 * Verified against a real run: 131 messages -> 65 kept, 32 kept, 34 omitted.
 */
export function elideTranscript(messages: readonly RenderedMessage[]): Elision {
  const rendered = messages.map((message, index) => ({
    role: message.role,
    text: `${devinMessageHeader(index, message.role)}\n${message.text}`,
  }));
  const full = rendered.map((entry) => entry.text).join(DEVIN_TRANSCRIPT_SEPARATOR);
  if (Buffer.byteLength(full, 'utf8') < DEVIN_TRANSCRIPT_LIMIT_BYTES) {
    return { text: full, omitted: 0 };
  }
  const count = rendered.length;
  const head = Math.floor(count / 2);
  const tail = Math.floor(count / 4);
  const omitted = count - head - tail;
  if (omitted <= 0) return { text: full, omitted: 0 };
  const kept = [
    ...rendered.slice(0, head).map((entry) => entry.text),
    devinOmittedMarker(omitted),
    ...rendered.slice(count - tail).map((entry) => entry.text),
  ];
  return { text: kept.join(DEVIN_TRANSCRIPT_SEPARATOR), omitted };
}
