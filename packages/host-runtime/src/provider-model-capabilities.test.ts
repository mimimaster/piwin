import { describe, expect, it } from 'vitest';
import { readExplicitVideoGenerationMetadata } from './provider-model-capabilities.js';

describe('readExplicitVideoGenerationMetadata', () => {
  it('recognizes Google long-running video generation metadata', () => {
    expect(
      readExplicitVideoGenerationMetadata('google-gemini', {
        supportedGenerationMethods: ['generateContent', 'predictLongRunning'],
      }),
    ).toEqual({ apiStyle: 'google-veo' });
  });

  it('does not infer video generation from a bare video input modality', () => {
    expect(
      readExplicitVideoGenerationMetadata('openai-compatible', {
        input_modalities: ['text', 'video'],
      }),
    ).toBeUndefined();
  });
});
