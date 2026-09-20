/**
 * Map Codex data-channel JSON into product LiveOwnerEvent. Wire names stay here.
 */

import type { LiveOwnerEvent } from '@piwin/contracts';
import { normalizeCodexDelegationCreated } from './codex-delegation.js';

export function parseLiveChannelMessage(raw: string): LiveOwnerEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const delegation = normalizeCodexDelegationCreated(value);
  if (delegation) return { type: 'delegation', ...delegation };
  return normalizeActivity(value);
}


function normalizeActivity(value: unknown): LiveOwnerEvent | null {
  if (!value || typeof value !== 'object') return null;
  const type = (value as Record<string, unknown>).type;
  if (typeof type !== 'string') return null;
  if (type === 'error') return { type: 'media-failed', mappedCode: 'live-protocol-failed' };
  if (type === 'input_transcript.added') return { type: 'activity', activity: 'user-speaking' };
  if (type === 'output_transcript.added') return { type: 'activity', activity: 'assistant-speaking' };
  if (type === 'turn.done') return { type: 'activity', activity: 'listening' };
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
  const feedback = !input.ok
    ? 'This request did not create a new task. Follow the Host context feedback; do not retry this delegation automatically.'
    : input.queueId
      ? 'Host accepted and queued the task. It is waiting to run. Wait for its result; do not claim completion or repeat the delegation.'
      : 'Host accepted and started the task. Wait for its result; do not claim completion or repeat the delegation.';
  return JSON.stringify({
    // Codex Live uses context.append. Product admission receipts are not a
    // documented upstream delegation.ack event; keep them on the Host side.
    type: 'delegation.context.append',
    delegation_item_id: input.providerDelegationId,
    channel: 'commentary',
    content: [{ type: 'input_text', text: feedback }],
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
  let chunk = '';
  let bytes = 0;
  // Iterate Unicode code points, never split an emoji's surrogate pair.
  for (const point of text) {
    const size = encoder.encode(point).byteLength;
    if (bytes + size > maxBytes) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += point;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
