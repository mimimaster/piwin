import type { LiveOwnerEvent } from '@piwin/contracts';

export type OpenaiRealtimeParsedMessage =
  | { kind: 'session-created' }
  | { kind: 'session-updated' }
  | { kind: 'owner'; event: LiveOwnerEvent }
  | { kind: 'tool-call'; id: string; instruction: string }
  | { kind: 'audio-delta'; base64: string }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' };

export const OPENAI_REALTIME_DELEGATE_TOOL = 'delegate_to_work_session';

export const OPENAI_REALTIME_LIVE_INSTRUCTIONS =
  'You are piwin Live, the realtime voice of the piwin desktop. Casual talk stays in this call. For work that needs files, code, tools, the current project, or anything that should appear in the chat page, you MUST call delegate_to_work_session with a clear instruction. Do not pretend you already did the work. After the tool returns, briefly tell the user it is in the current chat.';

export function openaiRealtimeSessionUpdatePayload(input: {
  voice: string;
  instructions?: string;
}): string {
  return JSON.stringify({
    type: 'session.update',
    session: {
      voice: input.voice,
      modalities: ['audio', 'text'],
      instructions: input.instructions ?? OPENAI_REALTIME_LIVE_INSTRUCTIONS,
      turn_detection: { type: 'server_vad' },
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      tool_choice: 'auto',
      tools: [
        {
          type: 'function',
          name: OPENAI_REALTIME_DELEGATE_TOOL,
          description:
            'Hand work to the current piwin chat session. Use this whenever the user wants you to do something in the app, write, search files, or change the project.',
          parameters: {
            type: 'object',
            properties: {
              instruction: {
                type: 'string',
                description: 'What the work session should do, in the user language.',
              },
            },
            required: ['instruction'],
          },
        },
      ],
    },
  });
}

export function openaiRealtimeAudioAppendPayload(base64Pcm16: string): string {
  return JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: base64Pcm16,
  });
}

export function openaiRealtimeFunctionOutputPayload(input: {
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

export function openaiRealtimeResponseCreatePayload(): string {
  return JSON.stringify({ type: 'response.create' });
}

export function openaiRealtimeContextAppendPayload(content: string): string {
  return JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: content }],
    },
  });
}

function instructionFromArguments(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { instruction?: unknown }).instruction === 'string') {
      return (parsed as { instruction: string }).instruction.trim();
    }
  } catch {
    return raw.trim();
  }
  return '';
}

export function parseOpenaiRealtimeMessage(raw: string): OpenaiRealtimeParsedMessage {
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
    const instruction = instructionFromArguments(record.arguments);
    if (name === OPENAI_REALTIME_DELEGATE_TOOL && id && instruction) {
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
      const instruction = instructionFromArguments(item.arguments);
      if (name === OPENAI_REALTIME_DELEGATE_TOOL && id && instruction) {
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
      error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'live-protocol-failed';
    return { kind: 'error', message };
  }
  return { kind: 'ignore' };
}
