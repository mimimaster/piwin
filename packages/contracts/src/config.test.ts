import { describe, expect, it } from 'vitest';
import { createDefaultSubagentConfig, THINKING_LEVEL_OPTIONS } from './config.js';
import type {
  ModelConfigEntry,
  ModelCapability,
  ModelRouteConfig,
  PiwinConfig,
  ImageGenerationConfig,
  SubagentConfig,
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

  it('accepts a video-generation route with a native async API style', () => {
    const entry: ModelConfigEntry = {
      id: 'sora-2',
      capabilities: ['video-generation'],
      routes: {
        'video-generation': {
          apiStyle: 'openai-videos',
          path: '/videos',
          timeoutMs: 900_000,
          pollIntervalMs: 5_000,
        },
      },
    };
    expect(entry.capabilities).toContain('video-generation');
    expect(entry.routes?.['video-generation']?.apiStyle).toBe('openai-videos');
    expect(entry.routes?.['video-generation']?.pollIntervalMs).toBe(5_000);
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

  it('accepts an explicit effort list and default effort', () => {
    const entry: ModelConfigEntry = {
      id: 'claude-max',
      reasoning: true,
      thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
      thinkingLevel: 'high',
    };
    expect(entry.thinkingLevels).toContain('max');
    expect(entry.thinkingLevels).toContain(entry.thinkingLevel);
  });
});

describe('THINKING_LEVEL_OPTIONS', () => {
  it('exposes the complete ordered thinking-level option set', () => {
    expect(THINKING_LEVEL_OPTIONS).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
  });
});

describe('PiwinConfig.imageGeneration', () => {
  it('accepts an imageGeneration default model', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 0,
      },
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

describe('PiwinConfig.videoGeneration', () => {
  it('accepts a videoGeneration default model independently from image generation', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 0,
      },
      videoGeneration: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'runway',
          modelId: 'gen4.5',
        },
      },
    };
    expect(config.videoGeneration?.defaultModel?.modelId).toBe('gen4.5');
  });
});

describe('PiwinConfig.subagents', () => {
  it('accepts a subagents block with profiles and limits', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 0,
      },
      subagents: {
        profiles: [
          {
            id: 'fast-explorer',
            description: 'Fast read-only codebase exploration',
            model: {
              protocol: 'openai-compatible',
              providerId: 'local-provider',
              modelId: 'fast-coder',
            },
            thinkingLevel: 'low',
            capabilities: ['read'],
            skillIds: [],
            isolation: 'readonly',
          },
        ],
        defaultProfileId: 'fast-explorer',
        maxConcurrency: 4,
        maxTasksPerRun: 8,
        processIsolation: 'required',
        parallelWritePolicy: 'worktree-only',
        dirtyBasePolicy: 'ask',
      },
    };
    expect(config.subagents?.profiles[0]?.id).toBe('fast-explorer');
    expect(config.subagents?.defaultProfileId).toBe('fast-explorer');
  });

  it('createDefaultSubagentConfig returns safe defaults', () => {
    const defaults = createDefaultSubagentConfig();
    expect(defaults.profiles).toEqual([]);
    expect(defaults.maxConcurrency).toBe(4);
    expect(defaults.processIsolation).toBe('required');
    expect(defaults.parallelWritePolicy).toBe('worktree-only');
    expect(defaults.dirtyBasePolicy).toBe('ask');
  });

  it('SubagentConfig type accepts empty profiles', () => {
    const cfg: SubagentConfig = {
      profiles: [],
      maxConcurrency: 2,
      maxTasksPerRun: 4,
      processIsolation: 'best-effort',
      parallelWritePolicy: 'disabled',
      dirtyBasePolicy: 'ask',
    };
    expect(cfg.profiles).toHaveLength(0);
    expect(cfg.processIsolation).toBe('best-effort');
  });
});
