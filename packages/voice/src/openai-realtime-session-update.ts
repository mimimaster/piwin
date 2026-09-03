import {
  composeLiveSpokenInstructions,
  PIWIN_LIVE_DELEGATE_INSTRUCTION_DESCRIPTION,
  PIWIN_LIVE_DELEGATE_TOOL_DESCRIPTION,
} from '@piwin/contracts';

export const OPENAI_REALTIME_DELEGATE_TOOL = 'delegate_to_work_session';

export const OPENAI_REALTIME_LIVE_INSTRUCTIONS = composeLiveSpokenInstructions('tool-handover');

export function openaiRealtimeSessionUpdatePayload(input: {
  voice: string;
  instructions?: string;
  startupContext?: string;
}): string {
  const base = input.instructions ?? OPENAI_REALTIME_LIVE_INSTRUCTIONS;
  const instructions = input.startupContext ? `${base}\n\n${input.startupContext}` : base;
  return JSON.stringify({
    type: 'session.update',
    session: {
      voice: input.voice,
      modalities: ['audio', 'text'],
      instructions,
      turn_detection: { type: 'server_vad' },
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      tool_choice: 'auto',
      tools: [
        {
          type: 'function',
          name: OPENAI_REALTIME_DELEGATE_TOOL,
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
