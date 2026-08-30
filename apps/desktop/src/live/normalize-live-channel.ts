/**
 * Map Codex data-channel JSON into product LiveOwnerEvent. Wire names stay here.
 */

import { LIVE_DELEGATION_INSTRUCTION_MAX_BYTES, type LiveOwnerEvent } from '@piwin/contracts';

export function parseLiveChannelMessage(raw: string): LiveOwnerEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const delegation = normalizeDelegationCreated(value);
  if (delegation) return delegation;
  return normalizeActivity(value);
}

function normalizeDelegationCreated(value: unknown): LiveOwnerEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type !== 'delegation.created') return null;
  const item = event.item;
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (record.type !== 'delegation' || record.target !== 'client') return null;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  if (!Array.isArray(record.content)) return null;

  const instruction = record.content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      const entry = part as Record<string, unknown>;
      if (entry.type === 'input_text' && typeof entry.text === 'string') return [entry.text];
      return [];
    })
    .join('')
    .trim();

  if (!instruction) return null;
  if (new TextEncoder().encode(instruction).byteLength > LIVE_DELEGATION_INSTRUCTION_MAX_BYTES) {
    return null;
  }
  return {
    type: 'delegation',
    providerDelegationId: record.id.trim(),
    instruction,
  };
}

function normalizeActivity(value: unknown): LiveOwnerEvent | null {
  if (!value || typeof value !== 'object') return null;
  const type = (value as Record<string, unknown>).type;
  if (typeof type !== 'string') return null;
  if (type === 'input_audio_buffer.speech_started') {
    return { type: 'activity', activity: 'user-speaking' };
  }
  if (
    type === 'output_audio_buffer.started' ||
    type === 'response.output_audio.delta' ||
    type === 'response.audio.delta'
  ) {
    return { type: 'activity', activity: 'assistant-speaking' };
  }
  if (
    type === 'input_audio_buffer.speech_stopped' ||
    type === 'output_audio_buffer.stopped' ||
    type === 'response.done'
  ) {
    return { type: 'activity', activity: 'listening' };
  }
  return null;
}

export function buildDelegationAckPayload(input: {
  providerDelegationId: string;
  ok: boolean;
  runId?: string;
  messageId?: string;
  queueId?: string;
}): string {
  return JSON.stringify({
    type: 'delegation.ack',
    item_id: input.providerDelegationId,
    ok: input.ok,
    ...(input.runId ? { run_id: input.runId } : {}),
    ...(input.messageId ? { message_id: input.messageId } : {}),
    ...(input.queueId ? { queue_id: input.queueId } : {}),
  });
}

/** Codex Live result handoff. Wire names stay here; contracts stay product-shaped. */
export const LIVE_CONTEXT_APPEND_CHUNK_BYTES = 500;

export function buildContextAppendPayloads(input: {
  target: 'session' | 'delegation';
  channel: 'speakable' | 'commentary';
  content: string;
  providerDelegationId?: string;
}): string[] {
  const chunks = splitUtf8Chunks(input.content, LIVE_CONTEXT_APPEND_CHUNK_BYTES);
  return chunks.map((text) =>
    JSON.stringify(
      input.target === 'delegation' && input.providerDelegationId
        ? {
            type: 'delegation.context.append',
            delegation_item_id: input.providerDelegationId,
            channel: input.channel,
            content: [{ type: 'input_text', text }],
          }
        : {
            type: 'session.context.append',
            channel: input.channel,
            content: [{ type: 'input_text', text }],
          },
    ),
  );
}

function splitUtf8Chunks(text: string, maxBytes: number): string[] {
  if (!text) return [];
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let end = Math.min(remaining.length, maxBytes);
    while (end > 1 && encoder.encode(remaining.slice(0, end)).byteLength > maxBytes) {
      end -= 1;
    }
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return chunks;
}
