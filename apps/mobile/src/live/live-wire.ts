import {
  LIVE_DELEGATION_INSTRUCTION_MAX_BYTES,
  composeLiveSpokenInstructions,
  PIWIN_LIVE_DELEGATE_INSTRUCTION_DESCRIPTION,
  PIWIN_LIVE_DELEGATE_TOOL_DESCRIPTION,
  type LiveOwnerEvent,
} from '@piwin/contracts';

export type MobileOpenaiRealtimeMessage =
  | { kind: 'session-created' }
  | { kind: 'session-updated' }
  | { kind: 'owner'; event: LiveOwnerEvent }
  | { kind: 'tool-call'; id: string; instruction: string }
  | { kind: 'audio-delta'; base64: string }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' };

export type MobileGeminiLiveMessage =
  | { kind: 'owner'; event: LiveOwnerEvent }
  | { kind: 'audio'; pcmBase64: string }
  | { kind: 'tool-call'; id: string; instruction: string }
  | { kind: 'setup-complete' }
  | { kind: 'go-away' };

export const GEMINI_LIVE_FIXED_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

const DELEGATE_TOOL = 'delegate_to_work_session';
const LIVE_INSTRUCTIONS = composeLiveSpokenInstructions('tool-handover');

export function floatToPcm16Base64(input: Float32Array<ArrayBufferLike>): string {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function pcm16Base64ToFloat(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return samples;
}

export function openaiSessionUpdatePayload(voice: string): string {
  return JSON.stringify({
    type: 'session.update',
    session: {
      voice,
      modalities: ['audio', 'text'],
      instructions: LIVE_INSTRUCTIONS,
      turn_detection: { type: 'server_vad' },
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      tool_choice: 'auto',
      tools: [
        {
          type: 'function',
          name: DELEGATE_TOOL,
          description: PIWIN_LIVE_DELEGATE_TOOL_DESCRIPTION,
          parameters: {
            type: 'object',
            properties: {
              instruction: {
                type: 'string',
                description: PIWIN_LIVE_DELEGATE_INSTRUCTION_DESCRIPTION,
              },
            },
            required: ['instruction'],
          },
        },
      ],
    },
  });
}

export function openaiAudioAppendPayload(base64Pcm16: string): string {
  return JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Pcm16 });
}

export function openaiFunctionOutputPayload(input: {
  callId: string;
  accepted: boolean;
  queued: boolean;
}): string {
  const status = input.accepted ? (input.queued ? 'queued' : 'accepted') : 'rejected';
  return JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: input.callId,
      output: JSON.stringify({ status }),
    },
  });
}

export function realtimeResponseCreatePayload(): string {
  return JSON.stringify({ type: 'response.create' });
}

export function realtimeContextAppendPayload(content: string): string {
  return JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: content }],
    },
  });
}

export function geminiSetupPayload(): string {
  return JSON.stringify({ setup: {} });
}

export function geminiAudioPayload(pcmBase64: string): string {
  return JSON.stringify({
    realtimeInput: {
      audio: { mimeType: 'audio/pcm;rate=16000', data: pcmBase64 },
    },
  });
}

export function geminiToolResponsePayload(input: {
  id: string;
  accepted: boolean;
  queued: boolean;
}): string {
  const status = input.accepted ? (input.queued ? 'queued' : 'accepted') : 'rejected';
  return JSON.stringify({
    toolResponse: {
      functionResponses: [
        {
          id: input.id,
          name: DELEGATE_TOOL,
          response: { status },
        },
      ],
    },
  });
}

export function geminiContextAppendPayload(content: string): string {
  return JSON.stringify({
    clientContent: {
      turns: [{ role: 'user', parts: [{ text: content }] }],
      turnComplete: true,
    },
  });
}

export function codexDelegationAckPayload(input: {
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

export function codexContextAppendPayloads(input: {
  target: 'session' | 'delegation';
  channel: 'speakable' | 'commentary';
  content: string;
  providerDelegationId?: string;
}): string[] {
  const chunks = splitUtf8Chunks(input.content, 500);
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

export function parseOpenaiRealtimeMessage(raw: string): MobileOpenaiRealtimeMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: 'ignore' };
  }
  if (!value || typeof value !== 'object') return { kind: 'ignore' };
  const record = value as {
    type?: unknown;
    delta?: unknown;
    error?: unknown;
    name?: unknown;
    call_id?: unknown;
    arguments?: unknown;
    item?: unknown;
  };
  const type = typeof record.type === 'string' ? record.type : '';
  if (type === 'session.created') return { kind: 'session-created' };
  if (type === 'session.updated') return { kind: 'session-updated' };
  if (type === 'response.function_call_arguments.done') {
    const name = typeof record.name === 'string' ? record.name : '';
    const id = typeof record.call_id === 'string' ? record.call_id : '';
    const instruction = readInstruction(record.arguments);
    if (name === DELEGATE_TOOL && id && instruction) {
      return { kind: 'tool-call', id, instruction };
    }
  }
  if (type === 'response.output_item.done' && record.item && typeof record.item === 'object') {
    const item = record.item as {
      type?: unknown;
      name?: unknown;
      call_id?: unknown;
      arguments?: unknown;
    };
    if (item.type === 'function_call') {
      const name = typeof item.name === 'string' ? item.name : '';
      const id = typeof item.call_id === 'string' ? item.call_id : '';
      const instruction = readInstruction(item.arguments);
      if (name === DELEGATE_TOOL && id && instruction) {
        return { kind: 'tool-call', id, instruction };
      }
    }
  }
  if (type === 'input_audio_buffer.speech_started') {
    return { kind: 'owner', event: { type: 'activity', activity: 'user-speaking' } };
  }
  if (type === 'input_audio_buffer.speech_stopped') {
    return { kind: 'owner', event: { type: 'activity', activity: 'listening' } };
  }
  if (type === 'response.created' || type === 'response.output_item.added') {
    return { kind: 'owner', event: { type: 'activity', activity: 'assistant-speaking' } };
  }
  if (type === 'response.done') {
    return { kind: 'owner', event: { type: 'activity', activity: 'listening' } };
  }
  if (
    (type === 'response.output_audio.delta' || type === 'response.audio.delta') &&
    typeof record.delta === 'string'
  ) {
    return { kind: 'audio-delta', base64: record.delta };
  }
  if (type === 'error') {
    const error = record.error;
    const message =
      error &&
      typeof error === 'object' &&
      typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'live-protocol-failed';
    return { kind: 'error', message };
  }
  return { kind: 'ignore' };
}

export function parseGeminiLiveMessage(raw: string): MobileGeminiLiveMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = asRecord(parsed);
  if (!root) return null;
  if ('setupComplete' in root) return { kind: 'setup-complete' };
  if ('goAway' in root) return { kind: 'go-away' };
  const toolCall = asRecord(root.toolCall);
  const calls = toolCall && Array.isArray(toolCall.functionCalls) ? toolCall.functionCalls : [];
  for (const item of calls) {
    const call = asRecord(item);
    if (!call || call.name !== DELEGATE_TOOL) continue;
    const args = asRecord(call.args);
    const instruction = typeof args?.instruction === 'string' ? args.instruction.trim() : '';
    const id = typeof call.id === 'string' ? call.id : '';
    if (instruction && id) return { kind: 'tool-call', id, instruction };
  }
  const server = asRecord(root.serverContent);
  const turn = asRecord(server?.modelTurn);
  const parts = turn && Array.isArray(turn.parts) ? turn.parts : [];
  for (const item of parts) {
    const part = asRecord(item);
    const inline = asRecord(part?.inlineData);
    if (inline && typeof inline.data === 'string' && /audio/i.test(String(inline.mimeType ?? ''))) {
      return { kind: 'audio', pcmBase64: inline.data };
    }
  }
  if (server?.interrupted === true) {
    return { kind: 'owner', event: { type: 'activity', activity: 'user-speaking' } };
  }
  if (server && asRecord(server.modelTurn)) {
    return { kind: 'owner', event: { type: 'activity', activity: 'assistant-speaking' } };
  }
  return null;
}

export function mapGeminiWsClose(code: number, reason: string): string {
  if (/prepayment credits are depleted|credits are depleted|billing/i.test(reason)) {
    return 'live-gemini-credits';
  }
  if (code === 1008 || /unauthenticated|api.?key|invalid token|permission/i.test(reason)) {
    return 'live-provider-auth';
  }
  return 'live-disconnected';
}

function readInstruction(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { instruction?: unknown }).instruction === 'string'
    ) {
      const instruction = (parsed as { instruction: string }).instruction.trim();
      return withinDelegationLimit(instruction) ? instruction : '';
    }
  } catch {
    const instruction = raw.trim();
    return withinDelegationLimit(instruction) ? instruction : '';
  }
  return '';
}

function withinDelegationLimit(value: string): boolean {
  return new TextEncoder().encode(value).byteLength <= LIVE_DELEGATION_INSTRUCTION_MAX_BYTES;
}

function splitUtf8Chunks(text: string, maxBytes: number): string[] {
  if (!text) return [];
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let end = Math.min(remaining.length, maxBytes);
    while (end > 1 && encoder.encode(remaining.slice(0, end)).byteLength > maxBytes) end -= 1;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return chunks;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
