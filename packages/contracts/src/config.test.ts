import { describe, expect, it } from 'vitest';
import {
  createDefaultSubagentConfig,
  modelSupportsCapability,
  THINKING_LEVEL_OPTIONS,
} from './config.js';
import type {
  ModelConfigEntry,
  ModelCapability,
  ModelRouteConfig,
  PiwinConfig,
  ImageGenerationConfig,
  SubagentConfig,
} from './config.js';
import {
  deriveMemoryHighWaterMiB,
  deriveMemoryLowWaterMiB,
  normalizeSessionRuntimeRetentionConfig,
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

  it('treats legacy models as chat models and requires explicit speech tags', () => {
    expect(modelSupportsCapability({}, 'chat')).toBe(true);
    expect(modelSupportsCapability({}, 'speech-to-text')).toBe(false);
    expect(modelSupportsCapability({ capabilities: ['speech-to-text'] }, 'speech-to-text')).toBe(
      true,
    );
    expect(modelSupportsCapability({ capabilities: ['text-to-speech'] }, 'speech-to-text')).toBe(
      false,
    );
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

describe('PiwinConfig.speech', () => {
  it('accepts independent ASR and TTS defaults', () => {
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
      speech: {
        asr: {
          defaultModel: {
            protocol: 'openai-compatible',
            providerId: 'openai',
            modelId: 'whisper-1',
          },
          language: 'zh',
        },
        tts: {
          defaultModel: {
            protocol: 'openai-compatible',
            providerId: 'openai',
            modelId: 'tts-1',
          },
          voice: 'alloy',
        },
      },
    };
    expect(config.speech?.asr?.defaultModel?.modelId).toBe('whisper-1');
    expect(config.speech?.tts?.voice).toBe('alloy');
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

describe('SessionRuntimeRetentionConfig normalization (ADR 0040)', () => {
  it('applies ADR defaults when the config is omitted', () => {
    const normalized = normalizeSessionRuntimeRetentionConfig(undefined);
    expect(normalized.idleTtlSeconds).toBe(600);
    expect(normalized.maxIdleRuntimes).toBe(2);
    expect(normalized.maxResidentRuntimes).toBeUndefined();
    expect(normalized.memoryHighWaterMiB).toBeUndefined();
  });

  it('clamps values into the supported range', () => {
    const normalized = normalizeSessionRuntimeRetentionConfig({
      idleTtlSeconds: -10,
      maxIdleRuntimes: -1,
      maxResidentRuntimes: 99,
      memoryHighWaterMiB: 10,
    });
    expect(normalized.idleTtlSeconds).toBe(0);
    expect(normalized.maxIdleRuntimes).toBe(0);
    expect(normalized.maxResidentRuntimes).toBe(8);
    expect(normalized.memoryHighWaterMiB).toBe(512);
  });

  it('derives the adaptive memory high water from system memory', () => {
    // 16 GiB system => 4096 MiB at 25%, clamped to 2048.
    expect(deriveMemoryHighWaterMiB(16 * 1024)).toBe(2048);
    // 1 GiB system => 256 MiB at 25%, clamped up to 512.
    expect(deriveMemoryHighWaterMiB(1024)).toBe(512);
    // 8 GiB system => 2048 MiB at 25%, within clamp.
    expect(deriveMemoryHighWaterMiB(8 * 1024)).toBe(2048);
  });

  it('derives the low-water target as 80% of the high water', () => {
    expect(deriveMemoryLowWaterMiB(2048)).toBe(1638);
    expect(deriveMemoryLowWaterMiB(512)).toBe(410);
  });

  it('keeps optional overrides as provided within clamps', () => {
    const normalized = normalizeSessionRuntimeRetentionConfig({
      idleTtlSeconds: 120,
      maxIdleRuntimes: 4,
      maxResidentRuntimes: 6,
      memoryHighWaterMiB: 1024,
    });
    expect(normalized).toEqual({
      idleTtlSeconds: 120,
      maxIdleRuntimes: 4,
      maxResidentRuntimes: 6,
      memoryHighWaterMiB: 1024,
    });
  });
});
