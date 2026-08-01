import { describe, expect, it } from 'vitest';
import type {
  ModelConfigEntry,
  ModelCapability,
  ModelRouteConfig,
  PiwinConfig,
  ImageGenerationConfig,
} from './config.js';

describe('ModelConfigEntry capabilities + routes', () => {
  it('accepts capabilities and routes', () => {
    const entry: ModelConfigEntry = {
      id: 'glm-image',
      label: 'GLM-图像生成',
      capabilities: ['image-generation'],
      routes: {
        'image-generation': {
          path: '/images/generations',
          timeoutMs: 300_000,
        },
      },
    };
    expect(entry.capabilities).toContain('image-generation');
    expect(entry.routes?.['image-generation']?.path).toBe('/images/generations');
  });

  it('accepts a chat-only model without capabilities (backward compat)', () => {
    const entry: ModelConfigEntry = { id: 'gpt-4.1' };
    expect(entry.capabilities).toBeUndefined();
  });

  it('accepts input modalities and reasoning flags', () => {
    const entry: ModelConfigEntry = {
      id: 'claude-sonnet',
      input: ['text', 'image'],
      reasoning: true,
    };
    expect(entry.input).toContain('image');
    expect(entry.reasoning).toBe(true);
  });
});

describe('PiwinConfig.imageGeneration', () => {
  it('accepts an imageGeneration default model', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: { maxBytes: 0, htmlUiModeDefault: false },
      imageGeneration: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'zhipu',
          modelId: 'glm-image',
        },
      },
    };
    expect(config.imageGeneration?.defaultModel?.modelId).toBe('glm-image');
  });
});
