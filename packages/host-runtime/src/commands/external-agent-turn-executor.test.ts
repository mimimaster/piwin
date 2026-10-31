import { describe, expect, it } from 'vitest';
import { TURN_CONTINUATION_PROMPT } from './prompt-preparation.js';
import { buildExternalAgentPrompt } from './external-agent-turn-executor.js';

describe('buildExternalAgentPrompt', () => {
  it('forwards media attachments without putting paths into the text', () => {
    const prompt = buildExternalAgentPrompt({
      text: 'what is this',
      attachments: [
        {
          id: 'img-1',
          kind: 'media',
          path: '/media/shot.png',
          mimeType: 'image/png',
          byteSize: 12,
          source: 'paste',
        },
      ],
    });
    expect(prompt.text).toBe('what is this');
    expect(prompt.text).not.toContain('/media/shot.png');
    expect(prompt.attachments).toEqual([
      {
        id: 'img-1',
        kind: 'media',
        path: '/media/shot.png',
        mimeType: 'image/png',
        byteSize: 12,
        source: 'paste',
      },
    ]);
  });

  it('does not invent a continuation user row payload', () => {
    const prompt = buildExternalAgentPrompt({
      text: 'ignored',
      source: 'continuation',
    });
    expect(prompt.text).toBe(TURN_CONTINUATION_PROMPT);
    expect(prompt.attachments).toBeUndefined();
  });
});
