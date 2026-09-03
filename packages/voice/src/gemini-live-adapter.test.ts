import { describe, expect, it } from 'vitest';
import { buildGeminiLiveTokenRequest } from './gemini-live-adapter.js';
import { GEMINI_LIVE_SYSTEM_INSTRUCTION } from './gemini-live-schema.js';

function readInstructionParts(body: Record<string, unknown>): Array<{ text: string }> {
  const setup = body.bidiGenerateContentSetup as {
    systemInstruction: { parts: Array<{ text: string }> };
  };
  return setup.systemInstruction.parts;
}

describe('buildGeminiLiveTokenRequest', () => {
  const base = {
    modelId: 'gemini-live-2.5',
    voice: 'Zephyr',
    thinkingLevel: 'low' as const,
    now: new Date('2026-09-03T00:00:00.000Z'),
  };

  it('sends only the spoken contract when there is no startup context', () => {
    const parts = readInstructionParts(buildGeminiLiveTokenRequest(base));
    expect(parts).toEqual([{ text: GEMINI_LIVE_SYSTEM_INSTRUCTION }]);
  });

  it('appends already-rendered startup context as a second instruction part', () => {
    const parts = readInstructionParts(
      buildGeminiLiveTokenRequest({ ...base, startupContext: '<startup_context>docs</startup_context>' }),
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]?.text).toBe(GEMINI_LIVE_SYSTEM_INSTRUCTION);
    expect(parts[1]?.text).toBe('<startup_context>docs</startup_context>');
  });
});