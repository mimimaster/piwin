import { describe, expect, it } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { isSpeechConfigured } from './use-workbench-panel-requests.js';

describe('isSpeechConfigured', () => {
  it('requires an enabled speech-to-text model on an enabled provider', () => {
    expect(isSpeechConfigured(null)).toBe(false);
    expect(
      isSpeechConfigured({
        providers: [
          {
            id: 'local',
            name: 'Local',
            protocol: 'openai-compatible',
            enabled: true,
            models: [
              {
                id: 'whisper',
                name: 'Whisper',
                protocol: 'openai-compatible',
                enabled: true,
                capabilities: ['speech-to-text'],
              },
            ],
          },
        ],
        speech: {
          asr: { defaultModel: { protocol: 'openai-compatible', providerId: 'local', modelId: 'whisper' } },
        },
      } as unknown as PiwinConfig),
    ).toBe(true);
  });
});
