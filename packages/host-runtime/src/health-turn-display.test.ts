import { describe, expect, it } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { healthProviderDisclosure, isExplicitAppleHealthTurn } from './health-turn-display.js';

describe('health turn display', () => {
  it('treats an @Health connected-source ref as explicit turn intent', () => {
    expect(
      isExplicitAppleHealthTurn([
        { kind: 'connected-source', source: 'apple-health', label: 'Apple Health' },
      ]),
    ).toBe(true);
    expect(isExplicitAppleHealthTurn(undefined)).toBe(false);
  });

  it('classifies loopback and Ollama providers as local, others as external', () => {
    expect(
      healthProviderDisclosure(
        { protocol: 'openai-compatible', providerId: 'ollama', modelId: 'llama3.2' },
        undefined,
      ),
    ).toMatchObject({ id: 'ollama', processing: 'local' });

    const loopback = {
      providers: [
        {
          id: 'lm',
          protocol: 'openai-compatible' as const,
          name: 'LM Studio',
          baseUrl: 'http://127.0.0.1:1234/v1',
          models: [],
        },
      ],
    } as unknown as PiwinConfig;
    expect(
      healthProviderDisclosure(
        { protocol: 'openai-compatible', providerId: 'lm', modelId: 'local-model' },
        loopback,
      ),
    ).toMatchObject({ id: 'lm', label: 'LM Studio', processing: 'local' });

    const cloud = {
      providers: [
        {
          id: 'openai',
          protocol: 'openai-compatible' as const,
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          models: [],
        },
      ],
    } as unknown as PiwinConfig;
    expect(
      healthProviderDisclosure(
        { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4o' },
        cloud,
      ),
    ).toMatchObject({ id: 'openai', label: 'OpenAI', processing: 'external' });
  });
});
