import { describe, expect, it } from 'vitest';
import { knowledgeCapabilityLights } from './knowledge-capabilities';
import type { PiwinConfig } from '@piwin/contracts';

describe('knowledgeCapabilityLights', () => {
  it('does not hard-code model names and reports configured vs unavailable', () => {
    const lights = knowledgeCapabilityLights({
      defaultProviderId: 'openai',
      defaultModelId: 'gpt-4o',
      knowledge: {
        parser: { mineru: { enabled: true } },
        embedding: { enabled: false },
      },
    } as PiwinConfig);
    expect(lights.find((light) => light.id === 'mineru')?.configured).toBe(true);
    expect(lights.find((light) => light.id === 'embedding')?.configured).toBe(false);
    expect(lights.find((light) => light.id === 'extractionLlm')?.configured).toBe(true);
    expect(JSON.stringify(lights)).not.toContain('gpt-4o');
  });
});
