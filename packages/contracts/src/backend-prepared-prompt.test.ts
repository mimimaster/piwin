import { describe, expect, it } from 'vitest';
import type { BackendPreparedPrompt } from './backend-prepared-prompt.js';

describe('BackendPreparedPrompt', () => {
  it('preserves native image content fields through JSON', () => {
    const prompt: BackendPreparedPrompt = {
      text: 'Describe the attached image.',
      runId: 'run-1',
      images: [{ dataBase64: 'aGVsbG8=', mimeType: 'image/png' }],
      streamingBehavior: 'followUp',
      model: {
        protocol: 'anthropic-compatible',
        providerId: 'provider-1',
        modelId: 'model-1',
      },
      thinkingLevel: 'medium',
    };

    const roundTripped = JSON.parse(JSON.stringify(prompt)) as unknown;

    expect(roundTripped).toEqual(prompt);
  });
});
