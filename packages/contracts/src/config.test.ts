import { describe, expect, it } from 'vitest';
import { createDefaultSubagentConfig, THINKING_LEVEL_OPTIONS } from './config.js';
import type {
  ModelConfigEntry,
  ModelCapability,
  type ModelRouteConfig,
  type PiwinConfig,
  type ImageGenerationConfig,
  type SubagentConfig,
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

describe('PiwinConfig.subagents', () => {
  it('accepts a subagents block with profiles and limits', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: { maxBytes: 0, htmlUiModeDefault: false },
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
        maxParallelWriteTasks: 4,
        processIsolation: 'required',
        parallelWritePolicy: 'worktree-only',
        requireCleanBaseForParallelWrites: true,
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
    expect(defaults.requireCleanBaseForParallelWrites).toBe(true);
  });

  it('SubagentConfig type accepts empty profiles', () => {
    const cfg: SubagentConfig = {
      profiles: [],
      maxConcurrency: 2,
      maxTasksPerRun: 4,
      maxParallelWriteTasks: 2,
      processIsolation: 'best-effort',
      parallelWritePolicy: 'disabled',
      requireCleanBaseForParallelWrites: false,
    };
    expect(cfg.profiles).toHaveLength(0);
    expect(cfg.processIsolation).toBe('best-effort');
  });
});
