import type { LiveOwnerEvent } from '@piwin/contracts';

export type GeminiLiveParsed =
  | { kind: 'owner'; event: LiveOwnerEvent }
  | { kind: 'audio'; pcmBase64: string }
  | { kind: 'tool-call'; id: string; instruction: string }
  | { kind: 'setup-complete' }
  | { kind: 'go-away' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseGeminiLiveMessage(raw: string): GeminiLiveParsed | null {
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
    if (!call || call.name !== 'delegate_to_work_session') continue;
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
          name: 'delegate_to_work_session',
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

/** Constrained tokens already lock setup; the first client frame still has to be `setup`. */
export function geminiSetupPayload(): string {
  return JSON.stringify({ setup: {} });
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

export function geminiAudioPayload(pcmBase64: string): string {
  return JSON.stringify({
    realtimeInput: {
      audio: { mimeType: 'audio/pcm;rate=16000', data: pcmBase64 },
    },
  });
}
