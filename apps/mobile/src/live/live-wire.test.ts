import { describe, expect, it } from 'vitest';
import {
  GEMINI_LIVE_FIXED_ENDPOINT,
  floatToPcm16Base64,
  geminiSetupPayload,
  parseGeminiLiveMessage,
  parseOpenaiRealtimeMessage,
  pcm16Base64ToFloat,
} from './live-wire.js';

describe('mobile Live wire adapters', () => {
  it('round-trips PCM16 samples without putting audio into text', () => {
    const encoded = floatToPcm16Base64(new Float32Array([-1, -0.25, 0, 0.25, 1]));
    const decoded = pcm16Base64ToFloat(encoded);

    expect(decoded.length).toBe(5);
    expect(decoded[0]).toBeCloseTo(-1);
    expect(decoded[1]).toBeCloseTo(-0.25, 2);
    expect(decoded[3]).toBeCloseTo(0.25, 2);
    expect(decoded[4]).toBeCloseTo(0.9999, 3);
  });

  it('normalizes OpenAI tool calls and activity events', () => {
    expect(
      parseOpenaiRealtimeMessage(
        JSON.stringify({
          type: 'response.function_call_arguments.done',
          name: 'delegate_to_work_session',
          call_id: 'call-1',
          arguments: JSON.stringify({ instruction: '检查移动端 Live' }),
        }),
      ),
    ).toEqual({ kind: 'tool-call', id: 'call-1', instruction: '检查移动端 Live' });
    expect(parseOpenaiRealtimeMessage('{"type":"response.done"}')).toEqual({
      kind: 'owner',
      event: { type: 'activity', activity: 'listening' },
    });
  });

  it('parses Gemini setup/audio and keeps the constrained endpoint fixed', () => {
    expect(JSON.parse(geminiSetupPayload())).toEqual({ setup: {} });
    expect(GEMINI_LIVE_FIXED_ENDPOINT).toContain('BidiGenerateContentConstrained');
    expect(parseGeminiLiveMessage('{"setupComplete":{}}')).toEqual({ kind: 'setup-complete' });
    expect(
      parseGeminiLiveMessage(
        JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AA==' } }],
            },
          },
        }),
      ),
    ).toEqual({ kind: 'audio', pcmBase64: 'AA==' });
  });
});
